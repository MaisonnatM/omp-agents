import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExtension } from "./fake-extension-api";
import personalExtension, { PERSONAL_FLAGS } from "./personal-extension";

const dirs: string[] = [];
afterEach(() => {
	setSystemTime();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The extension loaded as the dashboard loads it into every session, with a personal directory and a memory file that does not exist yet. */
function loadedPersonal(flags = true) {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-personal-"));
	dirs.push(root);
	const personal = join(root, "personal");
	const memory = join(root, "personal-memory.md");
	const named = new Map<string, string>(flags ? [[PERSONAL_FLAGS.dir, personal], [PERSONAL_FLAGS.memory, memory]] : []);
	return { personal, memory, ...loadExtension(personalExtension, named, "/work/app") };
}

test("a session in the personal directory remembers a fact as a dated line, and its next turn's prompt carries it", async () => {
	const session = loadedPersonal();
	session.start(session.personal);
	expect(session.tools()).toEqual(["remember"]);
	setSystemTime(new Date("2026-11-03T10:00:00.000Z"));
	await session.call("remember", { fact: "  Allergic to\npeanuts. " }, session.personal);
	await session.call("remember", { fact: "Cooks for four." }, session.personal);
	expect(readFileSync(session.memory, "utf8")).toBe("- 2026-11-03 Allergic to peanuts.\n- 2026-11-03 Cooks for four.\n");
	const [base, personal] = session.prompt("main", session.personal) ?? [];
	expect(base).toBe("base");
	expect(personal).toEndWith("\n- 2026-11-03 Allergic to peanuts.\n- 2026-11-03 Cooks for four.");
});

test("a session elsewhere gets neither the tool nor the memory, and a subagent in the personal directory gets no memory", async () => {
	const session = loadedPersonal();
	writeFileSync(session.memory, "- 2026-11-03 Allergic to peanuts.\n");
	session.start("/work/app");
	expect(session.tools()).toEqual([]);
	expect(session.prompt("main", "/work/app")).toEqual(undefined);
	expect(session.prompt("main", join(session.personal, "recipes"))).toEqual(undefined);
	expect(session.prompt("sub", session.personal)).toEqual(undefined);
	expect(session.prompt("main", session.personal)?.[1]).toEndWith("\n- 2026-11-03 Allergic to peanuts.");
});

test("without the dashboard's flags the extension stays inert in any directory", () => {
	const session = loadedPersonal(false);
	session.start(session.personal);
	expect(session.tools()).toEqual([]);
	expect(session.prompt("main", session.personal)).toEqual(undefined);
});

test("a session that moves into the personal directory gains remember on its next turn, and one that moves out can no longer write the memory", async () => {
	const session = loadedPersonal();
	session.start("/work/app");
	expect(session.tools()).toEqual([]);
	expect(session.prompt("main", session.personal)).toHaveLength(2);
	expect(session.tools()).toEqual(["remember"]);
	await expect(session.call("remember", { fact: "Cooks for four." }, "/work/app")).rejects.toThrow("not in the personal directory");
	expect(() => readFileSync(session.memory, "utf8")).toThrow("ENOENT");
});

test("a memory past 16 KiB reaches the prompt as its newest facts only", () => {
	const session = loadedPersonal();
	const lines = Array.from({ length: 1000 }, (_, index) => `- 2026-11-03 Fact number ${index}.`);
	writeFileSync(session.memory, `${lines.join("\n")}\n`);
	const prompt = session.prompt("main", session.personal)?.[1] ?? "";
	expect(prompt).toEndWith("\n- 2026-11-03 Fact number 999.");
	expect(prompt).not.toContain("Fact number 0.");
	const kept = prompt.split("\n").filter(line => line.startsWith("- 2026-11-03 Fact number "));
	expect(kept.join("\n").length).toBeLessThanOrEqual(16 * 1024);
	expect(kept.join("\n").length).toBeGreaterThan(15 * 1024);
});
