import { describe, expect, test } from "bun:test";
import { mkdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./omp/config";
import { loadOmpSettings, parseRoutingEdit, Rejected, routeRoles, saveOmpFile } from "./settings";
import type { CatalogModel, RoutingEdit } from "./shared";

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
