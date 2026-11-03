import { Database } from "bun:sqlite";
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
		const { store } = memory;
		expect(store.backend === "local" && store.files.map(file => [file.group, file.name, file.body.state])).toEqual([
			["lessons", "learned.md", "read"],
			["summary", "memory_summary.md", "read"],
			["skills", "deploy/SKILL.md", "read"],
			["rollouts", "one.md", "read"],
		]);
	});

	test("Off keeps no store, and so does a backend omp does not know", async () => {
		useBackend("off");
		expect(await loadOmpMemory(tempDir())).toEqual({ preview: null, store: { backend: "off" } });
		useBackend("notes");
		expect((await loadOmpMemory(tempDir())).store).toEqual({ backend: "off" });
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
		expect(saved.store).toMatchObject({ backend: "local" });
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
	const config: MnemopiConfig = { scoping: "per-project", globalBank: "default", retainBank: "project", recallBanks: ["project"], providerOptions: { noEmbeddings: true } };
	/** A bank database with `remember`'s rows, each written as `session`'s. */
	const seed = async (dbPath: string, rows: { session: string; content: string }[]): Promise<string[]> => {
		const { Mnemopi } = await mnemopiState.loadMnemopi();
		return rows.map(({ session, content }) => {
			const memory = new Mnemopi({ dbPath, bank: session, sessionId: session, noEmbeddings: true });
			try {
				return memory.remember(content);
			} finally {
				memory.close();
			}
		});
	};

	test("lists a bank's working rows, and updates, refuses, and forgets one against the text the page showed", async () => {
		const dbPath = join(tempDir(), "mnemopi.db");
		const bank = { bank: "project", dbPath };
		const [id = ""] = await seed(dbPath, [{ session: "project", content: "Prefers pnpm over npm" }]);

		const listed = await mnemopiRows(config, [bank, { bank: "absent", dbPath: join(tempDir(), "none.db") }]);
		expect("entries" in listed && listed.entries.map(entry => [entry.id, entry.content, entry.kind, entry.ops])).toEqual([[id, "Prefers pnpm over npm", "working", ["update", "forget"]]]);

		expect(await editMnemopiEntry(config, bank, { op: "update", bank: "project", id, expected: "something else", content: "x" })).toBe("changed");
		expect(await editMnemopiEntry(config, bank, { op: "retire", bank: "project", id, expected: "Prefers pnpm over npm" })).toBe("refused");
		expect(await editMnemopiEntry(config, bank, { op: "update", bank: "project", id, expected: "Prefers pnpm over npm", content: "Prefers bun" })).toBe("done");
		const updated = await mnemopiRows(config, [bank]);
		expect("entries" in updated && updated.entries[0]?.content).toBe("Prefers bun");
		expect(await editMnemopiEntry(config, bank, { op: "forget", bank: "project", id, expected: "Prefers bun" })).toBe("done");
		expect(await editMnemopiEntry(config, bank, { op: "forget", bank: "project", id, expected: "Prefers bun" })).toBe("missing");
		expect(await mnemopiRows(config, [bank])).toEqual({ entries: [], truncated: false });
	});

	test("lists only the rows the bank's session recalls: its own, not another bank's, and none past their end", async () => {
		const dbPath = join(tempDir(), "mnemopi.db");
		const [, , expired] = await seed(dbPath, [
			{ session: "project", content: "Ships on Fridays" },
			{ session: "other", content: "Another workspace's" },
			{ session: "project", content: "Was true once" },
		]);
		const db = new Database(dbPath);
		db.query("UPDATE working_memory SET valid_until = ?1 WHERE id = ?2").run(new Date(0).toISOString(), expired ?? "");
		db.close();
		const listed = await mnemopiRows(config, [{ bank: "project", dbPath }]);
		expect("entries" in listed && listed.entries.map(entry => entry.content)).toEqual(["Ships on Fridays"]);
	});
});
