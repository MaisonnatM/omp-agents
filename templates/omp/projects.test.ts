import { describe, expect, test } from "bun:test";
import { join } from "node:path";

interface Project {
	id: string;
	name: string;
	coordinator: { sessionId: string };
	workers: { id: string; title: string; sessionId: string }[];
	reviewCadence?: string;
}

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const extension: {
	ancestorSessionIds(sessionFile: string, exists: (path: string) => boolean): string[];
	findRole(projects: Project[], sessionId: string): { project: Project; worker: Project["workers"][number] | null } | null;
	roleText(role: { project: Project; worker: Project["workers"][number] | null; subagent: boolean }, notes: string, user: string): string;
	shellWrite(command: string, cwd: string, roots: readonly string[]): string | null;
} = await import(join(import.meta.dir, "agent/extensions/projects.ts"));
const { ancestorSessionIds, findRole, roleText, shellWrite } = extension;

const NOTES = "/data/omp-agents/projects/p1";
const USER = "/data/omp-agents/user";
const ROOTS = [NOTES, USER];
const CWD = "/work/app";
const PROJECT: Project & { workers: [Project["workers"][number]] } = { id: "p1", name: "Billing", coordinator: { sessionId: "s-c" }, workers: [{ id: "w1", title: "Schema", sessionId: "s-w1" }] };

describe("projects extension", () => {
	test("a task subagent's transcript names its parent sessions, nearest first", () => {
		const files = new Set(["/sessions/app/20261010_s-w1.jsonl", "/sessions/app/20261010_s-w1/0-Explore.jsonl"]);
		expect(ancestorSessionIds("/sessions/app/20261010_s-w1/0-Explore/1-Inner.jsonl", path => files.has(path))).toEqual(["0-Explore", "s-w1"]);
		expect(ancestorSessionIds("/sessions/app/20261010_s-w1.jsonl", path => files.has(path))).toEqual([]);
		expect(findRole([PROJECT], "s-w1")?.worker?.id).toBe("w1");
	});

	test("the role text gives a worker its learnings step, the coordinator its tools, delegation, cadence, and autonomy, and a coordinator's subagent its limit", () => {
		const worker = roleText({ project: PROJECT, worker: PROJECT.workers[0], subagent: false }, NOTES, USER);
		expect(worker).toContain("Before your final report, add to docs/testing.md or docs/research.md");
		const coordinator = roleText({ project: { ...PROJECT, reviewCadence: "failures only" }, worker: null, subagent: false }, NOTES, USER);
		for (const part of [
			"answer_worker",
			"end_worker",
			"plan, delegate, and report",
			"investigation, research, reviews, and browser checks included, with a prompt that says what to report back",
			"internal/checklist.md",
			"move finished items to archived.md",
			"inbox/; once you have handled it, delete the file or move its line to archived.md",
			"Promoted in notes.md",
			"review cadence is: failures only",
			"start the workers at once",
			"never for permission to start",
			"never write a prompt for the user to paste",
			"call end_worker for it in the same turn",
			"The user never sees those messages",
		]) {
			expect(coordinator).toContain(part);
		}
		expect(roleText({ project: PROJECT, worker: null, subagent: false }, NOTES, USER)).toContain("review cadence is: every PR");
		expect(roleText({ project: PROJECT, worker: null, subagent: true }, NOTES, USER)).toContain("You are a subagent of the coordinator");
		expect(roleText({ project: PROJECT, worker: PROJECT.workers[0], subagent: true }, NOTES, USER)).not.toContain("blocked");
	});

	test("every project session reads the project's notes.md and the user's preferences and workflows, and knows which notes a preference goes in", () => {
		for (const role of [
			{ project: PROJECT, worker: null, subagent: false },
			{ project: PROJECT, worker: PROJECT.workers[0], subagent: false },
			{ project: PROJECT, worker: PROJECT.workers[0], subagent: true },
		]) {
			const text = roleText(role, NOTES, USER);
			for (const part of [`Read ${NOTES}/notes.md first`, `Read ${USER}/preferences.md, and any workflow in ${USER}/workflows that fits the task`, "Record there a preference that holds beyond this project; one about this project only goes in the project's notes.md."]) {
				expect(text).toContain(part);
			}
		}
	});

	test("the coordinator's shell guard blocks redirections outside the notes and git or Graphite writes", () => {
		for (const command of ["echo hi > src/a.ts", "cat x >> ~/elsewhere.md", "printf x | tee README.md", "git commit -m wip", "git -C /work/app push", "FOO=1 git checkout main", "gt submit --draft", "echo x > /data/omp-agents/users.md"]) {
			expect({ command, why: shellWrite(command, CWD, ROOTS) }).toEqual({ command, why: expect.any(String) });
		}
	});

	test("read-only commands and writes into the notes run", () => {
		for (const command of [
			"git status && git log --oneline -5",
			"git diff main...HEAD",
			"gh pr view 12 --json title",
			'rg -n "=>" src | head',
			"ls -la 2>&1",
			"bun test 2>/dev/null",
			"gt log short",
			`echo "- found it" >> ${NOTES}/research.md`,
			`printf x | tee ${NOTES}/plan.md`,
			`echo "- short answers" >> ${USER}/preferences.md`,
			`cat draft.md > ${USER}/workflows/quality-pass.md`,
			"cat a.ts >&2",
		]) {
			expect({ command, why: shellWrite(command, CWD, ROOTS) }).toEqual({ command, why: null });
		}
	});
});
