import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clearMemory, loadOmpMemory, parseEntryEdit, saveMemoryFile } from "./memory";
import { agentDir, loadSessionSettings } from "./omp/config";
import { editMnemopiEntry, hindsightEntries, limitEntries, mnemopiBanks, mnemopiRows } from "./omp/memory";
import type { MnemopiConfig } from "./omp/module-types/memory";
import { localMemory, mnemopiState } from "./omp/modules";
import { Rejected } from "./settings";
import type { OmpMemoryEntry } from "./shared/omp-memory";

const dirs: string[] = [];
const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-memory-"));
	dirs.push(dir);
	return dir;
};
const useBackend = (backend: string | null): void => {
	const config = join(agentDir, "config.yml");
	if (backend === null) rmSync(config, { force: true });
	else writeFileSync(config, `memory:\n  backend: ${backend}\n`);
};
const sha = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const rejected = async (run: Promise<unknown>): Promise<Rejected> => {
	const err = await run.then(() => null, (thrown: unknown) => thrown);
	if (!(err instanceof Rejected)) throw new Error(`Expected a refusal, got ${String(err)}`);
	return err;
};

afterEach(() => {
	useBackend(null);
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadOmpMemory", () => {
	test("without a workspace it reads the settings only, off by omp's default", async () => {
		useBackend(null);
		const memory = await loadOmpMemory(null);
		expect(memory.backend).toMatchObject({ value: "off", source: { layer: "default" }, user: null });
		expect(memory.backend.options.map(option => option.value)).toEqual(["off", "local", "hindsight", "mnemopi", "sharpshooter"]);
		expect(memory.backend.options[1]?.label).toBe("Local");
		expect(memory.autolearn.enabled).toEqual({ value: false, source: { layer: "default" }, user: null });
		expect(memory.workspace).toBeNull();
	});

	test("Local lists the files of the workspace's store that exist, by group", async () => {
		useBackend("local");
		const cwd = tempDir();
		const root = localMemory.getMemoryRoot(agentDir, cwd);
		mkdirSync(join(root, "skills", "deploy"), { recursive: true });
		mkdirSync(join(root, "rollout_summaries"), { recursive: true });
		writeFileSync(join(root, "learned.md"), "- Run the checks first\n");
		writeFileSync(join(root, "memory_summary.md"), "Summary\n");
		writeFileSync(join(root, "skills", "deploy", "SKILL.md"), "# Deploy\n");
		writeFileSync(join(root, "rollout_summaries", "one.md"), "A session\n");
		const memory = await loadOmpMemory(cwd);
		expect(memory.backend).toMatchObject({ value: "local", source: { layer: "user" }, user: "local" });
		const store = memory.workspace?.store;
		expect(store?.backend === "local" && store.files.map(file => [file.group, file.name, file.body.state])).toEqual([
			["lessons", "learned.md", "read"],
			["summary", "memory_summary.md", "read"],
			["skills", "deploy/SKILL.md", "read"],
			["rollouts", "one.md", "read"],
		]);
	});

	test("Off keeps no store", async () => {
		useBackend("off");
		expect((await loadOmpMemory(tempDir())).workspace).toEqual({ preview: null, store: { backend: "off" } });
	});
});

describe("saveMemoryFile", () => {
	test("writes a listed file that still holds what the page read, and refuses any other", async () => {
		useBackend("local");
		const cwd = tempDir();
		const root = localMemory.getMemoryRoot(agentDir, cwd);
		mkdirSync(root, { recursive: true });
		const path = join(root, "learned.md");
		writeFileSync(path, "- old\n");
		const saved = await saveMemoryFile(cwd, { path, text: "- new\n", baseHash: sha("- old\n") });
		expect(readFileSync(path, "utf8")).toBe("- new\n");
		expect(saved.workspace?.store).toMatchObject({ backend: "local" });
		const stale = await rejected(saveMemoryFile(cwd, { path, text: "- again\n", baseHash: sha("- old\n") }));
		expect([stale.status, stale.conflict]).toEqual([409, true]);
		expect((await rejected(saveMemoryFile(cwd, { path: join(root, "elsewhere.md"), text: "", baseHash: null }))).status).toBe(404);
		expect((await rejected(saveMemoryFile(null, { path, text: "", baseHash: null }))).status).toBe(400);
	});
});

describe("clearMemory", () => {
	test("forgets the Local store only while Local is the backend the page showed", async () => {
		useBackend("local");
		const cwd = tempDir();
		const root = localMemory.getMemoryRoot(agentDir, cwd);
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "learned.md"), "- a lesson\n");
		const changed = await rejected(clearMemory(cwd, { backend: "sharpshooter" }));
		expect([changed.status, changed.conflict]).toEqual([409, true]);
		expect((await rejected(clearMemory(cwd, { backend: "hindsight" }))).status).toBe(400);
		expect(existsSync(root)).toBe(true);
		await clearMemory(cwd, { backend: "local" });
		expect(existsSync(root)).toBe(false);
	});

	test("Mnemopi keeps the bank every workspace reads and refuses when it is the only one", async () => {
		const cwd = tempDir();
		writeFileSync(join(agentDir, "config.yml"), "memory:\n  backend: mnemopi\nmnemopi:\n  scoping: per-project-tagged\n");
		const { banks, sharedBank } = await mnemopiBanks(await loadSessionSettings(cwd));
		expect(sharedBank).toBe("default");
		for (const { dbPath } of banks) {
			mkdirSync(dirname(dbPath), { recursive: true });
			writeFileSync(dbPath, "");
		}
		await clearMemory(cwd, { backend: "mnemopi" });
		expect(banks.map(({ bank, dbPath }) => [bank === sharedBank, existsSync(dbPath)])).toEqual([[false, false], [true, true]]);
		writeFileSync(join(agentDir, "config.yml"), "memory:\n  backend: mnemopi\nmnemopi:\n  scoping: global\n");
		expect((await rejected(clearMemory(cwd, { backend: "mnemopi" }))).status).toBe(400);
		rmSync(join(agentDir, "memories"), { recursive: true, force: true });
	});
});

describe("parseEntryEdit", () => {
	test("takes an update with new text, a forget, or a retire, each naming the row and what it held", () => {
		expect(parseEntryEdit({ op: "update", bank: "b", id: "1", expected: "old", content: "new" })).toEqual({ op: "update", bank: "b", id: "1", expected: "old", content: "new" });
		expect(parseEntryEdit({ op: "retire", bank: "b", id: "1", expected: "old", content: "ignored" })).toEqual({ op: "retire", bank: "b", id: "1", expected: "old" });
		expect(() => parseEntryEdit({ op: "update", bank: "b", id: "1", expected: "old", content: " " })).toThrow("new text");
		expect(() => parseEntryEdit({ op: "drop", bank: "b", id: "1", expected: "old" })).toThrow("update, forget, or retire");
		expect(() => parseEntryEdit({ op: "forget", bank: "b", id: "1" })).toThrow(Rejected);
	});
});

describe("hindsightEntries", () => {
	test("reads the server's items, skipping one without an id or text, and refuses an answer without a list", () => {
		expect(hindsightEntries({ items: [{ id: "m1", text: "Uses pnpm", mentioned_at: "2026-10-01T00:00:00Z" }, { id: 2, text: "no id" }] }, "omp")).toEqual([
			{ id: "m1", bank: "omp", content: "Uses pnpm", at: "2026-10-01T00:00:00Z", kind: "remote", ops: [] },
		]);
		expect(() => hindsightEntries({ memories: [] }, "omp")).toThrow("without a list");
	});
});

describe("limitEntries", () => {
	test("keeps the newest 500 and says there were more", () => {
		const entries = Array.from({ length: 502 }, (_, index): OmpMemoryEntry => ({ id: String(index), bank: "b", content: "", at: new Date(index * 1000).toISOString(), kind: "working", ops: [] }));
		const limited = limitEntries(entries);
		expect([limited.entries.length, limited.truncated, limited.entries[0]?.id]).toEqual([500, true, "501"]);
	});
});

describe("Mnemopi rows", () => {
	test("lists a bank's working rows, and updates, refuses, and forgets one against the text the page showed", async () => {
		const dbPath = join(tempDir(), "mnemopi.db");
		const bank = { bank: "project", dbPath };
		const config: MnemopiConfig = { scoping: "per-project", globalBank: "default", retainBank: "project", recallBanks: ["project"], providerOptions: { noEmbeddings: true } };
		const { Mnemopi } = await mnemopiState.loadMnemopi();
		const seed = new Mnemopi({ dbPath, bank: "project", sessionId: "project", noEmbeddings: true }) as unknown as { remember(content: string): string; close(): void };
		const id = seed.remember("Prefers pnpm over npm");
		seed.close();

		const listed = mnemopiRows([bank, { bank: "absent", dbPath: join(tempDir(), "none.db") }]);
		expect("entries" in listed && listed.entries.map(entry => [entry.id, entry.content, entry.kind, entry.ops])).toEqual([[id, "Prefers pnpm over npm", "working", ["update", "forget"]]]);

		expect(await editMnemopiEntry(config, bank, { op: "update", bank: "project", id, expected: "something else", content: "x" })).toBe("changed");
		expect(await editMnemopiEntry(config, bank, { op: "retire", bank: "project", id, expected: "Prefers pnpm over npm" })).toBe("refused");
		expect(await editMnemopiEntry(config, bank, { op: "update", bank: "project", id, expected: "Prefers pnpm over npm", content: "Prefers bun" })).toBe("done");
		const updated = mnemopiRows([bank]);
		expect("entries" in updated && updated.entries[0]?.content).toBe("Prefers bun");
		expect(await editMnemopiEntry(config, bank, { op: "forget", bank: "project", id, expected: "Prefers bun" })).toBe("done");
		expect(await editMnemopiEntry(config, bank, { op: "forget", bank: "project", id, expected: "Prefers bun" })).toBe("missing");
		expect(mnemopiRows([bank])).toEqual({ entries: [], truncated: false });
	});
});
