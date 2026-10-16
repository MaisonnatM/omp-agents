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
	roleText(role: { project: Project; worker: Project["workers"][number] | null; subagent: boolean }, notes: string): string;
	shellWrite(command: string, cwd: string, notes: string): string | null;
} = await import(join(import.meta.dir, "agent/extensions/projects.ts"));
const { ancestorSessionIds, findRole, roleText, shellWrite } = extension;

const NOTES = "/data/omp-agents/projects/p1";
const CWD = "/work/app";
const PROJECT: Project & { workers: [Project["workers"][number]] } = { id: "p1", name: "Billing", coordinator: { sessionId: "s-c" }, workers: [{ id: "w1", title: "Schema", sessionId: "s-w1" }] };

describe("projects extension", () => {
	test("a task subagent's transcript names its parent sessions, nearest first", () => {
		const files = new Set(["/sessions/app/20261010_s-w1.jsonl", "/sessions/app/20261010_s-w1/0-Explore.jsonl"]);
		expect(ancestorSessionIds("/sessions/app/20261010_s-w1/0-Explore/1-Inner.jsonl", path => files.has(path))).toEqual(["0-Explore", "s-w1"]);
		expect(ancestorSessionIds("/sessions/app/20261010_s-w1.jsonl", path => files.has(path))).toEqual([]);
		expect(findRole([PROJECT], "s-w1")?.worker?.id).toBe("w1");
	});

	test("the role text gives a worker its learnings step, the coordinator its tools and cadence, and a coordinator's subagent its limit", () => {
		const worker = roleText({ project: PROJECT, worker: PROJECT.workers[0], subagent: false }, NOTES);
		expect(worker).toContain("Before your final report, add to testing.md, preferences.md, or research.md");
		const coordinator = roleText({ project: { ...PROJECT, reviewCadence: "failures only" }, worker: null, subagent: false }, NOTES);
		for (const part of ["answer_worker", "end_worker", "checklist.md", "Promoted", "review cadence is: failures only", "preferences.md as soon as you hear them"]) expect(coordinator).toContain(part);
		expect(roleText({ project: PROJECT, worker: null, subagent: false }, NOTES)).toContain("review cadence is: every PR");
		expect(roleText({ project: PROJECT, worker: null, subagent: true }, NOTES)).toContain("You are a subagent of the coordinator");
		expect(roleText({ project: PROJECT, worker: PROJECT.workers[0], subagent: true }, NOTES)).not.toContain("blocked");
	});

	test("the coordinator's shell guard blocks redirections outside the notes and git or Graphite writes", () => {
		for (const command of ["echo hi > src/a.ts", "cat x >> ~/elsewhere.md", "printf x | tee README.md", "git commit -m wip", "git -C /work/app push", "FOO=1 git checkout main", "gt submit --draft"]) {
			expect({ command, why: shellWrite(command, CWD, NOTES) }).toEqual({ command, why: expect.any(String) });
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
			"cat a.ts >&2",
		]) {
			expect({ command, why: shellWrite(command, CWD, NOTES) }).toEqual({ command, why: null });
		}
	});
});
