import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDir } from "./omp/config";
import { editModelProfile, loadOmpSettings, parseAgentSettingEdit, parseRoutingEdit, Rejected, routeRoles, saveAgentSetting, saveOmpFile } from "./settings";
import type { AgentSettingRow } from "./shared/agent-settings";
import type { CatalogModel, OmpSettings, RoutingEdit } from "./shared/models";

describe("routeRoles", () => {
	test("a chat role without its own chain walks the default chain; a model-kind role does not", () => {
		const routing = routeRoles(
			{ default: "anthropic/claude-opus-5-5:high", smol: "anthropic/claude-haiku-4-5", image: "openai/gpt-image-2" },
			{ default: ["openai-codex/gpt-6-sol:high", "cursor/grok-4.7-high"] },
		);
		expect(routing).toEqual({
			roles: [
				{
					role: "default",
					primary: "anthropic/claude-opus-5-5:high",
					fallbacks: ["openai-codex/gpt-6-sol:high", "cursor/grok-4.7-high"],
					inheritsDefault: false,
				},
				{
					role: "smol",
					primary: "anthropic/claude-haiku-4-5",
					fallbacks: ["openai-codex/gpt-6-sol:high", "cursor/grok-4.7-high"],
					inheritsDefault: true,
				},
				{ role: "image", primary: "openai/gpt-image-2", fallbacks: [], inheritsDefault: false },
			],
			modelChains: [],
		});
	});

	test("model-keyed chains stay apart from roles, and a chain can name a role with no model", () => {
		const routing = routeRoles(
			{ default: "anthropic/claude-opus-5-5" },
			{ "anthropic/*": ["openrouter/anthropic/*"], task: ["cursor/grok-4.7-high"] },
		);
		expect(routing).toEqual({
			roles: [
				{ role: "default", primary: "anthropic/claude-opus-5-5", fallbacks: [], inheritsDefault: false },
				{ role: "task", primary: null, fallbacks: ["cursor/grok-4.7-high"], inheritsDefault: false },
			],
			modelChains: [{ key: "anthropic/*", fallbacks: ["openrouter/anthropic/*"] }],
		});
	});
});

const catalog: CatalogModel[] = [
	{ selector: "anthropic/claude-opus-5-5", provider: "anthropic", name: "Opus", contextWindow: 1_000_000, thinking: ["low", "high"] },
	{ selector: "openrouter/minimax/minimax-m3:batch", provider: "openrouter", name: "MiniMax batch", contextWindow: 200_000, thinking: ["low"] },
];
const retry = {
	enabled: true,
	maxRetries: 10,
	baseDelayMs: 500,
	maxDelayMs: 300_000,
	waitForUsageReset: false,
	modelFallback: true,
	usageAwareFallback: false,
	usageReservePct: 10,
	usageReservePolicy: "confirm",
	fallbackRevertPolicy: "cooldown-expiry",
};
const config = {
	modelRoles: { default: "anthropic/claude-opus-5-5:high" },
	fallbackChains: { default: ["cursor/grok-4.7-high"] },
	retry,
	modelProviderOrder: [],
};
const rejectionStatus = (run: () => unknown): number => {
	try {
		run();
	} catch (err) {
		if (err instanceof Rejected) return err.status;
		throw err;
	}
	throw new Error("expected a rejection");
};

describe("parseRoutingEdit", () => {
	test("a selector names a listed model, with an optional thinking level after an id that has its own colon", () => {
		const edit: RoutingEdit = { kind: "role", role: "default", fallbacks: ["openrouter/minimax/minimax-m3:batch:low", "anthropic/claude-opus-5-5"] };
		expect(parseRoutingEdit(edit, { catalog, config })).toEqual(edit);
		expect(rejectionStatus(() => parseRoutingEdit({ ...edit, fallbacks: ["anthropic/claude-nope:high"] }, { catalog, config }))).toBe(400);
	});

	test("an unlisted selector the config already names still saves, so keeping it never blocks a save", () => {
		const edit: RoutingEdit = { kind: "role", role: "default", fallbacks: ["anthropic/claude-opus-5-5:low", "cursor/grok-4.7-high"] };
		expect(parseRoutingEdit(edit, { catalog, config })).toEqual(edit);
	});

	test("retry values go through omp's own check", () => {
		expect(parseRoutingEdit({ kind: "retry", values: { usageReservePolicy: "auto" } }, { catalog, config })).toEqual({
			kind: "retry",
			values: { usageReservePolicy: "auto" },
		});
		expect(rejectionStatus(() => parseRoutingEdit({ kind: "retry", values: { usageReservePolicy: "always" } }, { catalog, config }))).toBe(400);
	});
});

describe("saveOmpFile", () => {
	const loadedHash = async (path: string): Promise<string | null> => {
		const file = (await loadOmpSettings(null)).files.find(found => found.path === path);
		return file?.body.state === "read" ? file.body.hash : null;
	};

	test("a file changed on disk since the page read it is not overwritten", async () => {
		const path = join(agentDir, "AGENTS.md");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path, "first\n");
		const baseHash = await loadedHash(path);
		writeFileSync(path, "changed in an editor\n");
		const stale = await saveOmpFile(null, { path, text: "from the page\n", baseHash }).catch((err: Rejected) => err);
		expect(stale).toMatchObject({ status: 409, conflict: true });
		expect(await Bun.file(path).text()).toBe("changed in an editor\n");

		await saveOmpFile(null, { path, text: "from the page\n", baseHash: await loadedHash(path) });
		expect(await Bun.file(path).text()).toBe("from the page\n");
	});

	test("a symlinked file keeps its link and target permissions after a save", async () => {
		const path = join(agentDir, "AGENTS.md");
		const target = join(agentDir, "target.md");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(target, "before\n", { mode: 0o600 });
		rmSync(path, { force: true });
		symlinkSync(target, path);
		const baseHash = await loadedHash(path);
		await saveOmpFile(null, { path, text: "after\n", baseHash });
		expect(readlinkSync(path)).toBe(target);
		expect(await Bun.file(target).text()).toBe("after\n");
		expect(statSync(target).mode & 0o777).toBe(0o600);
	});

	test("only a path omp's discovery lists for the workspace can be written", async () => {
		const outside = join(agentDir, "..", "elsewhere.md");
		const refused = await saveOmpFile(null, { path: outside, text: "x", baseHash: null }).catch((err: Rejected) => err);
		expect(refused).toMatchObject({ status: 404 });
		expect(await Bun.file(outside).exists()).toBe(false);
	});

	test("config.yml must stay YAML omp can read", async () => {
		const path = join(agentDir, "config.yml");
		writeFileSync(path, "modelRoles: {}\n");
		const refused = await saveOmpFile(null, { path, text: "modelRoles: [\n", baseHash: await loadedHash(path) }).catch((err: Rejected) => err);
		expect(refused).toMatchObject({ status: 400 });
		expect(await Bun.file(path).text()).toBe("modelRoles: {}\n");
	});
});

describe("parseAgentSettingEdit", () => {
	test("an edit is a value or a reset, with the user value the page showed", () => {
		expect(parseAgentSettingEdit({ id: "compaction.enabled", value: false, expected: null })).toEqual({ id: "compaction.enabled", value: false, expected: null });
		expect(parseAgentSettingEdit({ id: "compaction.enabled", reset: true, expected: false })).toEqual({ id: "compaction.enabled", reset: true, expected: false });
		for (const raw of [{ id: "compaction.enabled", value: false }, { id: 3, value: false, expected: null }, { id: "compaction.enabled", reset: false, expected: null }, null]) {
			expect(() => parseAgentSettingEdit(raw)).toThrow("Expected { id, value, expected } or { id, reset: true, expected }");
		}
		expect(parseAgentSettingEdit({ id: "task.agentModelOverrides", entry: "reviewer", value: ["@slow:high", "provider/model"], expected: null })).toEqual({ id: "task.agentModelOverrides", entry: "reviewer", value: ["@slow:high", "provider/model"], expected: null });
		expect(parseAgentSettingEdit({ id: "task.agentModelOverrides", entry: "legacy.agent", reset: true, expected: "@slow" })).toEqual({ id: "task.agentModelOverrides", entry: "legacy.agent", reset: true, expected: "@slow" });
		for (const raw of [
			{ id: "task.maxConcurrency", entry: "reviewer", value: 2, expected: null },
			{ id: "task.agentModelOverrides", entry: "", value: "@slow", expected: null },
			{ id: "task.agentModelOverrides", entry: "reviewer", value: [], expected: null },
			{ id: "task.agentModelOverrides", entry: "reviewer", value: ["@slow", ""], expected: null },
			{ id: "task.agentModelOverrides", entry: "reviewer", value: "@slow", expected: 2 },
			{ id: "task.agentModelOverrides", entry: "reviewer", reset: true, expected: { nested: "@slow" } },
		]) expect(() => parseAgentSettingEdit(raw)).toThrow();
	});
});

describe("saveAgentSetting", () => {
	const path = join(agentDir, "config.yml");
	const row = (settings: OmpSettings, id: string): AgentSettingRow | undefined =>
		"error" in settings.agentSettings ? undefined : settings.agentSettings.tabs.flatMap(tab => tab.groups.flatMap(group => group.rows)).find(found => found.id === id);

	test("a save writes only that setting to config.yml, and a reset removes it", async () => {
		writeFileSync(path, "modelRoles: {}\n");
		const saved = await saveAgentSetting(null, { id: "compaction.enabled", value: false, expected: null });
		expect(row(saved, "compaction.enabled")).toMatchObject({ user: false });
		expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual({ modelRoles: {}, compaction: { enabled: false } });

		const reset = await saveAgentSetting(null, { id: "compaction.enabled", reset: true, expected: false });
		expect(row(reset, "compaction.enabled")).not.toHaveProperty("user");
		expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual({ modelRoles: {} });
	});

	test("a value changed in config.yml since the page read it is not overwritten", async () => {
		writeFileSync(path, "compaction:\n  enabled: true\n");
		const stale = await saveAgentSetting(null, { id: "compaction.enabled", value: false, expected: null }).catch((err: Rejected) => err);
		expect(stale).toMatchObject({ status: 409, conflict: true });
		expect(await Bun.file(path).text()).toBe("compaction:\n  enabled: true\n");
	});

	test("a credential is checked against whether it is set, never its text", async () => {
		writeFileSync(path, "hindsight:\n  apiToken: old-token\n");
		const saved = await saveAgentSetting(null, { id: "hindsight.apiToken", value: "new-token", expected: true });
		expect(row(saved, "hindsight.apiToken")).toMatchObject({ user: true });
		expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual({ hindsight: { apiToken: "new-token" } });
	});

	test("only a setting a session reads can be written, with a value omp accepts", async () => {
		writeFileSync(path, "modelRoles: {}\n");
		for (const id of ["theme.dark", "no.such.setting"]) {
			expect(await saveAgentSetting(null, { id, value: "x", expected: null }).catch((err: Rejected) => err)).toMatchObject({ status: 404 });
		}
		expect(await saveAgentSetting(null, { id: "compaction.enabled", value: "yes", expected: null }).catch((err: Rejected) => err)).toMatchObject({ status: 400 });
		expect(await Bun.file(path).text()).toBe("modelRoles: {}\n");
	});

	test("entry saves and clears preserve other user entries and never copy workspace overrides", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "agent-entry-"));
		mkdirSync(join(cwd, ".omp"), { recursive: true });
		writeFileSync(join(cwd, ".omp", "config.yml"), "task:\n  agentModelOverrides:\n    reviewer: workspace/model\n    workspace-only: workspace/other\n");
		writeFileSync(path, "task:\n  maxConcurrency: 8\n  agentModelOverrides:\n    researcher: ['unknown/selector:high', '@slow']\n");
		try {
			const saved = await saveAgentSetting(cwd, { id: "task.agentModelOverrides", entry: "reviewer", value: ["@plan:high", "provider/*"], expected: null });
			expect("error" in saved.agents ? saved.agents : saved.agents.userOverrides).toEqual({ researcher: ["unknown/selector:high", "@slow"], reviewer: ["@plan:high", "provider/*"] });
			expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual({ task: { maxConcurrency: 8, agentModelOverrides: { researcher: ["unknown/selector:high", "@slow"], reviewer: ["@plan:high", "provider/*"] } } });
			const stale = await saveAgentSetting(cwd, { id: "task.agentModelOverrides", entry: "reviewer", reset: true, expected: null }).catch((err: Rejected) => err);
			expect(stale).toMatchObject({ status: 409, conflict: true });
			await saveAgentSetting(cwd, { id: "task.agentModelOverrides", entry: "reviewer", reset: true, expected: ["@plan:high", "provider/*"] });
			expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual({ task: { maxConcurrency: 8, agentModelOverrides: { researcher: ["unknown/selector:high", "@slow"] } } });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("editModelProfile", () => {
	const path = join(agentDir, "config.yml");
	const profiles = (settings: OmpSettings) => ("error" in settings.routing ? settings.routing : settings.routing.profiles);
	const fullPower = [
		"# My routing",
		"modelRoles:",
		"  default: anthropic/claude-opus-5-5:high",
		"  smol: anthropic/claude-haiku-4-5",
		"retry:",
		"  maxRetries: 5",
		"  fallbackChains:",
		"    default:",
		"      - cursor/grok-4.7-high",
		"modelProviderOrder:",
		"  - anthropic",
		"  - cursor",
		"compaction:",
		"  enabled: false",
		"",
	].join("\n");

	test("applying a profile puts back its roles, chains, and provider order, and leaves every other key", async () => {
		writeFileSync(path, fullPower);
		await editModelProfile(null, { kind: "save", name: "Full power" });
		writeFileSync(path, ["modelRoles:", "  default: anthropic/claude-haiku-4-5", "  plan: cursor/grok-4.7-high", "retry:", "  maxRetries: 5", "modelProviderOrder:", "  - cursor", "compaction:", "  enabled: false", ""].join("\n"));
		const credits = await editModelProfile(null, { kind: "save", name: "Save credits" });
		expect(profiles(credits)).toEqual([
			{ name: "Full power", active: false },
			{ name: "Save credits", active: true },
		]);

		const applied = await editModelProfile(null, { kind: "apply", name: "Full power" });
		expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual(Bun.YAML.parse(fullPower));
		expect(profiles(applied)).toEqual([
			{ name: "Full power", active: true },
			{ name: "Save credits", active: false },
		]);
		expect(await editModelProfile(null, { kind: "apply", name: "No such profile" }).catch((err: Rejected) => err)).toMatchObject({ status: 404 });
		await editModelProfile(null, { kind: "delete", name: "Full power" });
		await editModelProfile(null, { kind: "delete", name: "Save credits" });
	});

	test("a profile is active while config.yml routes as it does, whatever order its keys are written in", async () => {
		writeFileSync(path, fullPower);
		await editModelProfile(null, { kind: "save", name: "Ordered" });
		writeFileSync(path, ["modelProviderOrder: [anthropic, cursor]", "retry:", "  fallbackChains:", "    default: [cursor/grok-4.7-high]", "modelRoles:", "  smol: anthropic/claude-haiku-4-5", "  default: anthropic/claude-opus-5-5:high", ""].join("\n"));
		expect(profiles(await loadOmpSettings(null))).toEqual([{ name: "Ordered", active: true }]);
		writeFileSync(path, fullPower.replace("  - anthropic\n  - cursor", "  - cursor\n  - anthropic"));
		expect(profiles(await loadOmpSettings(null))).toEqual([{ name: "Ordered", active: false }]);
		await editModelProfile(null, { kind: "delete", name: "Ordered" });
	});
});
