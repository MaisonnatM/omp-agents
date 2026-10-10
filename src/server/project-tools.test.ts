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
};

const control = (project: Project): ProjectControl => ({
	project: id => (id === "p1" ? project : undefined),
	phaseOf: worker => (worker.id === "w2" ? "asking" : "idle"),
	questionsOf: worker => (worker.id === "w2" ? ["Which retry policy?"] : []),
	startWorker: async (_project, spec) => ({ workerId: "w5", cwd: spec.cwd ?? "/work/app" }),
	messageWorker: async () => {},
});

const run = (name: string, params: Record<string, unknown>, project = PROJECT) =>
	projectTools("p1", control(project))
		.find(tool => tool.name === name)!
		.execute(params, { toolCallId: "t1", signal: new AbortController().signal });

describe("updateText", () => {
	test("names each worker, quotes its last reply cut to length, and says who can answer a question", () => {
		const text = updateText(PROJECT, [
			{ id: "u1", workerId: "w3", at: AT, kind: "finished" },
			{ id: "u2", workerId: "w2", at: AT, kind: "asked", requestId: "r1", question: "Which retry policy?" },
			{ id: "u3", workerId: "w1", at: AT, kind: "stopped" },
			{ id: "u4", workerId: "w4", at: AT, kind: "finished" },
			{ id: "u5", workerId: "w1", at: AT, kind: "finished" },
		]);
		expect(text.split("\n")).toEqual([
			"[omp-agents] Project update.",
			`- w3 "Docs" finished its turn. Last reply (truncated to ${REPLY_QUOTE_CHARS} chars):`,
			`  ${"x".repeat(REPLY_QUOTE_CHARS)}`,
			'- w2 "API" asks: "Which retry policy?" Only the user can answer it in the dashboard; tell them.',
			'- w1 "Schema" stopped.',
			'- w4 "Lint" finished its turn with no text reply.',
			'- w1 "Schema" finished its turn. Last reply:',
			"  Renamed X to Y.",
			"  All tests pass.",
			"Use read_worker for more, message_worker to reply.",
		]);
	});
});

describe("projectTools", () => {
	test("list, read, start, and message answer for the project's workers, and an unknown worker is an error", async () => {
		expect(await run("list_workers", {})).toBe(
			["w1 · Schema · idle · /work/app · Renamed X to Y.", "w2 · API · asking · /work/api · ", `w3 · Docs · idle · /work/app · ${LONG}`, "w4 · Lint · idle · /work/app · "].join("\n"),
		);
		expect(await run("read_worker", { worker: "w2" })).toBe(['w2 "API" · asking · /work/api', "No finished turn yet.", "Waits on the user for: Which retry policy?"].join("\n"));
		expect(await run("start_worker", { title: "Docs  v2", prompt: "Write docs.", cwd: " sub " })).toBe('Started w5 "Docs v2" in sub. You are told when it finishes or asks; do not poll.');
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
		] as const) {
			await expect(run(name, params, archived)).rejects.toThrow("Project Billing is archived");
		}
	});
});
