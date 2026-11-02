import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerExtensionApproval, parseExtensionChange, readExtensionOperation, startExtensionChange } from "./extensions";
import { assertRegistryReadable, changeExtensions, discoverExtensions, loadExtensions, workspaceExtensions } from "./omp/extensions";
import { discovery, skillManifest } from "./omp/modules";
import { configWrites, setting } from "./omp/config";
import { withDiscovery } from "./omp/scoped-discovery";
import { loadOmpSettings, saveOmpFile } from "./settings";
import type { ExtensionOperation, ExtensionTarget } from "./shared/extensions";

const hooks = { confirmScripts: async () => false, warn: () => {} };
async function settled(id: string): Promise<ExtensionOperation> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const value = readExtensionOperation(null, id);
		if (value.state !== "working") return value;
		await Promise.resolve();
	}
	throw new Error("Operation did not settle");
}

test("extension changes reject arbitrary operations, scope confusion, and credential-bearing registry URLs", () => {
	for (const raw of [
		null,
		{ kind: "install", packageKind: "unknown", spec: "x", source: "", scope: "user" },
		{ kind: "enabled", key: "x", enabled: "false" },
		{ kind: "provider", id: "omp", enabled: true },
		{ kind: "registry", url: "file:///tmp/x" },
		{ kind: "registry", url: "https://token:secret@example.com" },
	])
		expect(() => parseExtensionChange(raw, null)).toThrow();
	expect(parseExtensionChange({ kind: "install", packageKind: "plugin", spec: " ./local ", source: "link", scope: "user" }, null)).toEqual({
		kind: "install",
		packageKind: "plugin",
		spec: "./local",
		source: "link",
		scope: "user",
	});
	expect(parseExtensionChange({ kind: "registry", url: "https://example.com/" }, null)).toEqual({ kind: "registry", url: "https://example.com" });
	expect(() => parseExtensionChange({ kind: "install", packageKind: "plugin", spec: "x", source: "", scope: "project" }, "/workspace")).toThrow(
		"all workspaces",
	);
	expect(() => parseExtensionChange({ kind: "update", target: { kind: "marketplace", id: "x@y", scope: "project" } }, null)).toThrow("Pick a workspace");
	expect(parseExtensionChange({ kind: "update", target: { kind: "marketplace", id: "x@y", scope: "project" } }, "/workspace")).toEqual({
		kind: "update",
		target: { kind: "marketplace", id: "x@y", scope: "project" },
	});
	expect(() => parseExtensionChange({ kind: "enabled", target: { kind: "plugin", id: "x", scope: "project" }, enabled: true }, "/workspace")).toThrow(
		"all workspaces",
	);
});

test("script approval is bound to a workspace and exact request token, and does not run until answered", async () => {
	let approved: boolean | undefined;
	const operation = startExtensionChange(null, { kind: "source-add", source: "test" }, async (_cwd, _change, nativeHooks) => {
		approved = await nativeHooks.confirmScripts({ id: "@test/review", version: "1.2.3", files: [{ path: "scripts/run.sh", executable: true }] });
	});
	const waiting = await settled(operation.id);
	expect(waiting.state).toBe("needs-approval");
	if (waiting.state !== "needs-approval") throw new Error("Expected script approval");
	expect(waiting.approval).toMatchObject({ id: "@test/review", version: "1.2.3", files: [{ path: "scripts/run.sh", executable: true }] });
	expect(approved).toBeUndefined();
	expect(() => answerExtensionApproval("/another/workspace", { id: operation.id, token: waiting.approval.token, approved: true })).toThrow();
	expect(() => answerExtensionApproval(null, { id: operation.id, token: "stale", approved: true })).toThrow();
	answerExtensionApproval(null, { id: operation.id, token: waiting.approval.token, approved: false });
	expect((await settled(operation.id)).state).toBe("done");
	expect(approved).toBe(false);
	expect(() => answerExtensionApproval(null, { id: operation.id, token: waiting.approval.token, approved: true })).toThrow();
});

test("registry mutations queue behind script approval and keep native warnings and failures", async () => {
	const order: string[] = [];
	const first = startExtensionChange(null, { kind: "source-add", source: "one" }, async (_cwd, _change, nativeHooks) => {
		order.push("first");
		await nativeHooks.confirmScripts({ id: "@test/one", version: "2", files: [] });
	});
	const second = startExtensionChange(null, { kind: "source-add", source: "two" }, async (_cwd, _change, nativeHooks) => {
		order.push("second");
		nativeHooks.warn("Native warning");
		throw new Error("Native refusal");
	});
	const waiting = await settled(first.id);
	if (waiting.state !== "needs-approval") throw new Error("Expected script approval");
	expect(order).toEqual(["first"]);
	answerExtensionApproval(null, { id: first.id, token: waiting.approval.token, approved: true });
	expect(await settled(second.id)).toMatchObject({ state: "failed", error: "Native refusal", warnings: ["Native warning"] });
	expect(order).toEqual(["first", "second"]);
});

test("malformed native registries are not treated as an empty writable source", async () => {
	const dir = await mkdtemp(join(tmpdir(), "oa-extension-registry-"));
	try {
		const path = join(dir, "registry.json");
		await assertRegistryReadable(path, "plugins");
		for (const value of ["{", "null", JSON.stringify({ version: 2, plugins: [] })]) {
			await Bun.write(path, value);
			await expect(assertRegistryReadable(path, "plugins")).rejects.toThrow("Repair it before managing packages");
			expect(await Bun.file(path).text()).toBe(value);
		}
		await Bun.write(path, JSON.stringify({ version: 1, marketplaces: [] }));
		await assertRegistryReadable(path, "marketplaces");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("native local marketplace lifecycle preserves scope, contributions, workflow read-only boundaries, and disabled state on update", async () => {
	const root = await mkdtemp(join(tmpdir(), "oa-extension-market-"));
	const source = join(root, "market");
	const cwd = join(root, "project");
	const name = `extensions-test-${crypto.randomUUID().slice(0, 8)}`;
	const plugin = "review-kit";
	let installedTarget: ExtensionTarget | undefined;
	try {
		await mkdir(join(source, ".claude-plugin"), { recursive: true });
		await mkdir(join(source, plugin, ".claude-plugin"), { recursive: true });
		await mkdir(join(source, plugin, "skills", "review-flow"), { recursive: true });
		await mkdir(join(cwd, ".omp", "plugins"), { recursive: true });
		await Bun.write(
			join(source, ".claude-plugin", "marketplace.json"),
			JSON.stringify({
				name,
				owner: { name: "Tests" },
				plugins: [{ name: plugin, source: `./${plugin}`, version: "1.0.0", description: "A local test package" }],
			}),
		);
		await Bun.write(join(source, plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: plugin, version: "1.0.0" }));
		await Bun.write(
			join(source, plugin, "skills", "review-flow", "SKILL.md"),
			"---\nname: extension-review-flow\ndescription: Test review flow\nmetadata:\n  tags: workflow\n---\nReview this.\n",
		);
		await changeExtensions(cwd, { kind: "source-add", source }, hooks);
		const catalog = await discoverExtensions(cwd, name, "review", 1);
		expect(catalog.entries).toContainEqual(expect.objectContaining({ name: plugin, source: name }));
		await changeExtensions(cwd, { kind: "install", packageKind: "marketplace", spec: plugin, source: name, scope: "project" }, hooks);
		const snapshot = await loadExtensions(cwd);
		const pkg = snapshot.packages.find((pkg) => pkg.target.id === `${plugin}@${name}` && pkg.target.scope === "project");
		expect(pkg?.version).toBe("1.0.0");
		if (!pkg || pkg.target.kind !== "marketplace") throw new Error("Installed marketplace package missing");
		const target = pkg.target;
		installedTarget = target;
		expect(pkg.contributions.some((item) => item.kind === "skills" && item.name === "extension-review-flow")).toBe(true);
		expect((await loadExtensions(null)).packages.some((pkg) => pkg.target.id === target.id && pkg.target.scope === target.scope)).toBe(false);
		const settings = await loadOmpSettings(cwd);
		const workflow = settings.workflows.find((workflow) => workflow.name === "extension-review-flow");
		expect(settings.files.find((file) => file.path === workflow?.skill)?.packaged).toBeTruthy();
		await expect(saveOmpFile(cwd, { path: workflow!.skill, text: "changed", baseHash: null })).rejects.toMatchObject({ status: 404 });
		await changeExtensions(cwd, { kind: "enabled", target, enabled: false }, hooks);
		expect((await loadExtensions(cwd)).packages.find((row) => row.target.id === target.id && row.target.scope === target.scope)?.enabled).toBe(false);
		await changeExtensions(cwd, { kind: "update", target }, hooks);
		expect((await loadExtensions(cwd)).packages.find((row) => row.target.id === target.id && row.target.scope === target.scope)?.enabled).toBe(false);
		await changeExtensions(cwd, { kind: "enabled", target, enabled: true }, hooks);
		expect((await workspaceExtensions(cwd)).items.some((item) => item.name === "extension-review-flow" && item.state === "available")).toBe(true);
		await changeExtensions(cwd, { kind: "uninstall", target }, hooks);
		installedTarget = undefined;
		expect((await loadExtensions(cwd)).packages.some((row) => row.target.id === pkg.target.id)).toBe(false);
	} finally {
		if (installedTarget) await changeExtensions(cwd, { kind: "uninstall", target: installedTarget }, hooks).catch(() => {});
		await changeExtensions(cwd, { kind: "source-remove", name }, hooks).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

test("registry skills retain locked range, missing-store state, and a named disable rather than a package flag", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "oa-extension-skills-"));
	const name = `review-${crypto.randomUUID().slice(0, 8)}`;
	const id = `@exttest/${name}`;
	const store = skillManifest.getSkillStorePath("exttest", name, "1.2.3");
	try {
		await mkdir(join(cwd, ".omp"), { recursive: true });
		const paths = await skillManifest.getSkillsInstallPaths({ global: false, cwd });
		await Bun.write(paths.manifest, JSON.stringify({ skills: { [id]: "^1.0.0" } }));
		await Bun.write(paths.lock, JSON.stringify({ version: 1, skills: { [id]: { version: "1.2.3", integrity: "sha512-test", resolved: "/tarball" } } }));
		let pkg = (await loadExtensions(cwd)).packages.find((pkg) => pkg.target.id === id);
		expect(pkg).toMatchObject({ target: { kind: "registry-skill", scope: "project" }, range: "^1.0.0", version: "1.2.3", stored: false, enabled: null });
		await mkdir(store, { recursive: true });
		await Bun.write(join(store, ".skillshare-integrity"), "sha512-test");
		await Bun.write(join(store, "SKILL.md"), `---\nname: ${name}\ndescription: Test registry skill\n---\nReview this.\n`);
		pkg = (await loadExtensions(cwd)).packages.find((pkg) => pkg.target.id === id);
		expect(pkg?.stored).toBe(true);
		expect(pkg?.contributions.some((item) => item.name === name)).toBe(true);
		expect(() => parseExtensionChange({ kind: "enabled", target: pkg?.target, enabled: false }, cwd)).toThrow("Registry packages");
		await changeExtensions(cwd, { kind: "skill-enabled", name, enabled: false }, hooks);
		expect((await workspaceExtensions(cwd)).items.find((item) => item.name === name)?.state).toBe("disabled");
		await changeExtensions(cwd, { kind: "skill-enabled", name, enabled: true }, hooks);
		expect((await workspaceExtensions(cwd)).items.find((item) => item.name === name)?.state).toBe("available");
		if (!pkg) throw new Error("Installed skill missing");
		await changeExtensions(cwd, { kind: "uninstall", target: pkg.target }, hooks);
		expect((await loadExtensions(cwd)).packages.some((pkg) => pkg.target.id === id)).toBe(false);
	} finally {
		await changeExtensions(cwd, { kind: "skill-enabled", name, enabled: true }, hooks).catch(() => {});
		await rm(store, { recursive: true, force: true });
		await rm(cwd, { recursive: true, force: true });
	}
}, 30_000);

test("discovery keeps each workspace binding until its read finishes and recovers after a refusal", async () => {
	const root = await mkdtemp(join(tmpdir(), "oa-extension-binding-"));
	const a = join(root, "a");
	const b = join(root, "b");
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	const order: string[] = [];
	try {
		for (const cwd of [a, b]) await mkdir(join(cwd, ".omp"), { recursive: true });
		await Bun.write(join(a, ".omp", "config.yml"), "disabledProviders:\n  - cursor\n");
		await Bun.write(join(b, ".omp", "config.yml"), "disabledProviders: []\n");
		const cursor = () => discovery.getAllProvidersInfo().find((provider) => provider.id === "cursor")?.enabled;
		const first = withDiscovery(a, async () => {
			order.push("first");
			expect(cursor()).toBe(false);
			entered.resolve();
			await resume.promise;
			expect(cursor()).toBe(false);
			order.push("resumed");
		});
		await entered.promise;
		const second = withDiscovery(b, async () => {
			order.push("second");
			expect(cursor()).toBe(true);
		});
		await Promise.resolve();
		expect(order).toEqual(["first"]);
		resume.resolve();
		await Promise.all([first, second]);
		expect(order).toEqual(["first", "resumed", "second"]);
		await expect(
			withDiscovery(a, async () => {
				throw new Error("Read refused");
			}),
		).rejects.toThrow("Read refused");
		expect(await withDiscovery(b, async () => cursor())).toBe(true);
		await Bun.write(join(a, ".omp", "config.yml"), "disabledProviders: [\n");
		await expect(withDiscovery(a, async () => "unreachable")).rejects.toThrow();
		expect(await withDiscovery(a, async (settings) => setting("disabledProviders").get(settings), { allowInvalidSettings: true })).toEqual([]);
		expect(await withDiscovery(b, async () => cursor())).toBe(true);
	} finally {
		resume.resolve();
		await rm(root, { recursive: true, force: true });
	}
});

test("extension config changes wait on the shared settings writer", async () => {
	const previous = (await loadExtensions(null)).registry.global;
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	const first = configWrites.run(async () => {
		entered.resolve();
		await resume.promise;
	});
	await entered.promise;
	let finished = false;
	const second = changeExtensions(null, { kind: "registry", url: "https://registry.example.test" }, hooks).then(() => {
		finished = true;
	});
	try {
		await Promise.resolve();
		expect(finished).toBe(false);
	} finally {
		resume.resolve();
	}
	await Promise.all([first, second]);
	await changeExtensions(null, { kind: "registry", url: previous }, hooks);
	expect(finished).toBe(true);
});
