import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerExtensionApproval, parseExtensionChange, readExtensionOperation, startExtensionChange } from "./extensions";
import { assertRegistryReadable, changeExtensions, discoverExtensions, loadExtensions, workspaceExtensions } from "./omp/extensions";
import { skillManifest } from "./omp/modules";
import { loadOmpSettings, saveOmpFile } from "./settings";
import type { ExtensionOperation } from "./shared/extensions";

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
	for (const raw of [null, { kind: "install", packageKind: "unknown", spec: "x", source: "", scope: "user" }, { kind: "enabled", key: "x", enabled: "false" }, { kind: "provider", id: "omp", enabled: true }, { kind: "registry", url: "file:///tmp/x" }, { kind: "registry", url: "https://token:secret@example.com" }]) expect(() => parseExtensionChange(raw)).toThrow();
	expect(parseExtensionChange({ kind: "install", packageKind: "plugin", spec: " ./local ", source: "link", scope: "user" })).toEqual({ kind: "install", packageKind: "plugin", spec: "./local", source: "link", scope: "user" });
	expect(parseExtensionChange({ kind: "registry", url: "https://example.com/" })).toEqual({ kind: "registry", url: "https://example.com" });
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
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("native local marketplace lifecycle preserves scope, contributions, workflow read-only boundaries, and disabled state on update", async () => {
	const root = await mkdtemp(join(tmpdir(), "oa-extension-market-"));
	const source = join(root, "market");
	const cwd = join(root, "project");
	const name = `extensions-test-${crypto.randomUUID().slice(0, 8)}`;
	const plugin = "review-kit";
	let installedKey: string | undefined;
	try {
		await mkdir(join(source, ".claude-plugin"), { recursive: true });
		await mkdir(join(source, plugin, ".claude-plugin"), { recursive: true });
		await mkdir(join(source, plugin, "skills", "review-flow"), { recursive: true });
		await mkdir(join(cwd, ".omp", "plugins"), { recursive: true });
		await Bun.write(join(source, ".claude-plugin", "marketplace.json"), JSON.stringify({ name, owner: { name: "Tests" }, plugins: [{ name: plugin, source: `./${plugin}`, version: "1.0.0", description: "A local test package" }] }));
		await Bun.write(join(source, plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: plugin, version: "1.0.0" }));
		await Bun.write(join(source, plugin, "skills", "review-flow", "SKILL.md"), "---\nname: extension-review-flow\ndescription: Test review flow\nmetadata:\n  tags: workflow\n---\nReview this.\n");
		await changeExtensions(cwd, { kind: "source-add", source }, hooks);
		const catalog = await discoverExtensions(cwd, name, "review", 1);
		expect(catalog.entries).toContainEqual(expect.objectContaining({ name: plugin, source: name }));
		await changeExtensions(cwd, { kind: "install", packageKind: "marketplace", spec: plugin, source: name, scope: "project" }, hooks);
		const snapshot = await loadExtensions(cwd);
		const pkg = snapshot.packages.find(pkg => pkg.id === `${plugin}@${name}` && pkg.scope === "project");
		expect(pkg?.version).toBe("1.0.0");
		if (!pkg) throw new Error("Installed package missing");
		installedKey = pkg.key;
		expect(pkg.contributions.some(item => item.kind === "skills" && item.name === "extension-review-flow")).toBe(true);
		expect((await loadExtensions(null)).packages.some(pkg => pkg.key === installedKey)).toBe(false);
		const settings = await loadOmpSettings(cwd);
		const workflow = settings.workflows.find(workflow => workflow.name === "extension-review-flow");
		expect(workflow?.packageSource).toBeTruthy();
		expect(settings.files.some(file => file.path === workflow?.skill)).toBe(false);
		await expect(saveOmpFile(cwd, { path: workflow!.skill, text: "changed", baseHash: null })).rejects.toMatchObject({ status: 404 });
		await changeExtensions(cwd, { kind: "enabled", key: pkg.key, enabled: false }, hooks);
		expect((await loadExtensions(cwd)).packages.find(row => row.key === pkg.key)?.enabled).toBe(false);
		await changeExtensions(cwd, { kind: "update", key: pkg.key }, hooks);
		expect((await loadExtensions(cwd)).packages.find(row => row.key === pkg.key)?.enabled).toBe(false);
		await changeExtensions(cwd, { kind: "enabled", key: pkg.key, enabled: true }, hooks);
		expect((await workspaceExtensions(cwd)).items.some(item => item.name === "extension-review-flow" && item.state === "available")).toBe(true);
		await changeExtensions(cwd, { kind: "uninstall", key: pkg.key }, hooks);
		installedKey = undefined;
		expect((await loadExtensions(cwd)).packages.some(row => row.id === pkg.id)).toBe(false);
	} finally {
		if (installedKey) await changeExtensions(cwd, { kind: "uninstall", key: installedKey }, hooks).catch(() => {});
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
		let pkg = (await loadExtensions(cwd)).packages.find(pkg => pkg.id === id);
		expect(pkg).toMatchObject({ kind: "registry-skill", scope: "project", range: "^1.0.0", version: "1.2.3", stored: false, enabled: null });
		await mkdir(store, { recursive: true });
		await Bun.write(join(store, ".skillshare-integrity"), "sha512-test");
		await Bun.write(join(store, "SKILL.md"), `---\nname: ${name}\ndescription: Test registry skill\n---\nReview this.\n`);
		pkg = (await loadExtensions(cwd)).packages.find(pkg => pkg.id === id);
		expect(pkg?.stored).toBe(true);
		expect(pkg?.contributions.some(item => item.name === name)).toBe(true);
		await expect(changeExtensions(cwd, { kind: "enabled", key: pkg!.key, enabled: false }, hooks)).rejects.toThrow("no package switch");
		await changeExtensions(cwd, { kind: "skill-enabled", name, enabled: false }, hooks);
		expect((await workspaceExtensions(cwd)).items.find(item => item.name === name)?.state).toBe("disabled");
		await changeExtensions(cwd, { kind: "skill-enabled", name, enabled: true }, hooks);
		expect((await workspaceExtensions(cwd)).items.find(item => item.name === name)?.state).toBe("available");
		await changeExtensions(cwd, { kind: "uninstall", key: pkg!.key }, hooks);
		expect((await loadExtensions(cwd)).packages.some(pkg => pkg.id === id)).toBe(false);
	} finally {
		await changeExtensions(cwd, { kind: "skill-enabled", name, enabled: true }, hooks).catch(() => {});
		await rm(store, { recursive: true, force: true });
		await rm(cwd, { recursive: true, force: true });
	}
}, 30_000);
