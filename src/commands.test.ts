import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandPrompt, withPinnedSkill } from "./commands";

/** A project directory with the file command `/review` and the skill `greet`; nothing else is defined in it. */
const cwd = mkdtempSync(join(tmpdir(), "omp-agents-commands-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

mkdirSync(join(cwd, ".omp", "commands"), { recursive: true });
writeFileSync(join(cwd, ".omp", "commands", "review.md"), "---\ndescription: Review\n---\nReview $1 carefully. All arguments: $ARGUMENTS\n");
mkdirSync(join(cwd, ".omp", "skills", "greet"), { recursive: true });
writeFileSync(join(cwd, ".omp", "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Say hello\n---\nSay hello to the user.\n");

// The catalog is cached per instance id and cwd, so each test uses its own session.
let sessions = 0;
const expand = (text: string, target: "session" | "subagent" = "session"): Promise<string> => expandPrompt(`commands-${++sessions}`, cwd, text, target);

describe("expandPrompt", () => {
	test("plain text goes to the host unchanged", async () => {
		expect(await expand("fix the tests")).toBe("fix the tests");
		expect(await expand("see /review in the docs")).toBe("see /review in the docs");
	});

	test("a file command expands with its arguments before a session prompt", async () => {
		expect(await expand("/review src/a.ts and more")).toBe("Review src/a.ts carefully. All arguments: src/a.ts and more");
	});

	test("a file command typed to a subagent goes through as typed, because the host expands it there", async () => {
		expect(await expand("/review src/a.ts", "subagent")).toBe("/review src/a.ts");
	});

	test("a skill invocation expands into the skill's instructions followed by what the user typed, for both targets", async () => {
		for (const target of ["session", "subagent"] as const) {
			const message = await expand("/skill:greet to Ada", target);
			expect(message).toContain("Say hello to the user.");
			expect(message).toContain(join(cwd, ".omp", "skills", "greet"));
			expect(message.endsWith("User: to Ada")).toBe(true);
			expect(message).not.toContain("/skill:greet");
		}
	});

	test("a slash command the host's Collab pipeline cannot run is rejected for both targets, not sent as text", async () => {
		await expect(expand("/compact now")).rejects.toThrow("/compact");
		await expect(expand("/compact now", "subagent")).rejects.toThrow("/compact");
		await expect(expand("/skill:missing do it")).rejects.toThrow("/skill:missing");
	});
});

describe("withPinnedSkill", () => {
	test("a first prompt goes through the pinned skill, with the prompt as its arguments", async () => {
		expect(await withPinnedSkill(cwd, "greet", "to Ada")).toBe("/skill:greet to Ada");
		expect(await withPinnedSkill(cwd, "greet", "")).toBe("/skill:greet");
	});

	test("no pin, a skill the directory lacks, or a prompt that opens with its own command leaves the prompt as typed", async () => {
		expect(await withPinnedSkill(cwd, null, "to Ada")).toBe("to Ada");
		expect(await withPinnedSkill(cwd, "missing", "to Ada")).toBe("to Ada");
		expect(await withPinnedSkill(cwd, "greet", "/review src/a.ts")).toBe("/review src/a.ts");
		expect(await withPinnedSkill(cwd, "greet", "  /skill:greet to Bo")).toBe("  /skill:greet to Bo");
	});
});
