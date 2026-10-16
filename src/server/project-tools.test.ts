import { describe, expect, test } from "bun:test";
import type { Project } from "../shared/projects";
import { type ProjectControl, projectTools, REPLY_QUOTE_CHARS, updateText } from "./project-tools";

const AT = "2026-10-10T08:00:00.000Z";
const LONG = "x".repeat(REPLY_QUOTE_CHARS + 10);
const PROJECT: Project = {
	id: "p1",
	name: "Billing",
	cwd: "/work/app",
	createdAt: AT,
	archived: false,
	coordinator: { sessionId: "s-c" },
	workers: [
		{ id: "w1", title: "Schema", sessionId: "s-w1", cwd: "/work/app", startedAt: AT, lastReply: { at: AT, text: "Renamed X to Y.\nAll tests pass." } },
		{ id: "w2", title: "API", sessionId: "s-w2", cwd: "/work/api", startedAt: AT, lastReply: null },
		{ id: "w3", title: "Docs", sessionId: "s-w3", cwd: "/work/app", startedAt: AT, lastReply: { at: AT, text: LONG } },
		{ id: "w4", title: "Lint", sessionId: "s-w4", cwd: "/work/app", startedAt: AT, lastReply: { at: AT, text: "" } },
	],
	updates: [],
	nextWorker: 5,
	maxWorkers: 3,
	watch: { pullRequests: true, linear: null },
	reviewCadence: "every PR",
	queue: [{ id: "q1", title: "Later", at: AT, start: { cwd: "/work/app", prompt: "Later.", branch: null, model: null, thinking: null, skill: null, tools: null } }],
};

const control = (project: Project): ProjectControl => ({
	project: id => (id === "p1" ? project : undefined),
	phaseOf: worker => (worker.id === "w2" ? "asking" : "idle"),
	questionsOf: worker => (worker.id === "w2" ? [{ id: "r1", title: "Which retry policy?" }] : []),
	startWorker: async (_project, spec) => (spec.title === "Busy" ? { kind: "queued", position: 2 } : { kind: "started", workerId: "w5", cwd: spec.cwd ?? "/work/app" }),
	messageWorker: async () => {},
	answerWorker: () => {},
	endWorker: async () => {},
});

const run = (name: string, params: Record<string, unknown>, project = PROJECT) =>
	projectTools("p1", control(project))
		.find(tool => tool.name === name)!
		.execute(params, { toolCallId: "t1", signal: new AbortController().signal });

describe("updateText", () => {
	test("names each worker, quotes its last reply cut to length, and offers to answer a question", () => {
		const text = updateText(PROJECT, [
			{ id: "u1", workerId: "w3", at: AT, kind: "finished" },
			{ id: "u2", workerId: "w2", at: AT, kind: "asked", requestId: "r1", question: "Which retry policy?" },
			{ id: "u3", workerId: "w1", at: AT, kind: "stopped" },
			{ id: "u4", workerId: "w4", at: AT, kind: "finished" },
			{ id: "u5", workerId: "w1", at: AT, kind: "finished" },
			{ id: "u6", at: AT, kind: "restarted", workers: ["w2"] },
			{ id: "u7", at: AT, kind: "event", source: "GitHub", title: "#12 merged", text: "", url: null },
		]);
		expect(text.split("\n")).toEqual([
			"[omp-agents] Project update.",
			`- w3 "Docs" finished its turn. Last reply (truncated to ${REPLY_QUOTE_CHARS} chars):`,
			`  ${"x".repeat(REPLY_QUOTE_CHARS)}`,
			'- w2 "API" asks (request r1): "Which retry policy?" Answer it with answer_worker when you can; otherwise tell the user, who can answer it in the dashboard.',
			'- w1 "Schema" stopped.',
			'- w4 "Lint" finished its turn with no text reply.',
			'- w1 "Schema" finished its turn. Last reply:',
			"  Renamed X to Y.",
			"  All tests pass.",
			'- The dashboard restarted and stopped w2 "API". message_worker resumes one that should go on.',
			"- GitHub: #12 merged",
			"Use read_worker for more, message_worker to reply.",
		]);
	});
});

describe("projectTools", () => {
	test("list, read, start, and message answer for the project's workers, and an unknown worker is an error", async () => {
		expect(await run("list_workers", {})).toBe(
			[
				"w1 · Schema · idle · /work/app · Renamed X to Y.",
				"w2 · API · asking · /work/api · ",
				`w3 · Docs · idle · /work/app · ${LONG}`,
				"w4 · Lint · idle · /work/app · ",
				"queued 1 · Later",
				"At most 3 work at once.",
			].join("\n"),
		);
		expect(await run("read_worker", { worker: "w2" })).toBe(['w2 "API" · asking · /work/api', "No finished turn yet.", "Waits on request r1: Which retry policy?"].join("\n"));
		expect(await run("start_worker", { title: "Docs  v2", prompt: "Write docs.", cwd: " sub " })).toBe('Started w5 "Docs v2" in sub. You are told when it finishes or asks; do not poll.');
		expect(await run("start_worker", { title: "Busy", prompt: "Wait.", cwd: null })).toBe('Queued "Busy" at position 2: the project runs its most workers at once. It starts when one finishes; do not poll.');
		expect(await run("message_worker", { worker: " w1 ", text: "Use PKCE." })).toBe("Sent to w1. You are told when it finishes or asks; do not poll.");
		await expect(run("message_worker", { worker: "w9", text: "hi" })).rejects.toThrow("has no worker w9");
	});

	test("every tool refuses to act once the project is archived", async () => {
		const archived = { ...PROJECT, archived: true };
		for (const [name, params] of [
			["start_worker", { title: "Docs", prompt: "Write docs.", cwd: null }],
			["list_workers", {}],
			["read_worker", { worker: "w1" }],
			["message_worker", { worker: "w1", text: "hi" }],
			["answer_worker", { worker: "w1", requestId: "r1", answer: "yes" }],
			["end_worker", { worker: "w1" }],
		] as const) {
			await expect(run(name, params, archived)).rejects.toThrow("Project Billing is archived");
		}
	});
});
