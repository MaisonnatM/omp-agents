import { describe, expect, test } from "bun:test";
import { applyScheduled, parseScheduledSpec, type ScheduledSend } from "./scheduled";
import { newSessionRequest } from "./sessions";

const start = (prompt: string) => ({ kind: "start" as const, request: newSessionRequest("/work/app", prompt) });
const send = (id: string, at: number, state: ScheduledSend["state"] = { phase: "waiting" }): ScheduledSend => ({ id, at, reset: null, target: start(id), createdAt: 1, state });

describe("applyScheduled update", () => {
	test("replaces a failed send's time and target, keeps its creation time, sets it waiting again, and reorders the list", () => {
		const sends = [send("a", 10, { phase: "failed", error: "gone", at: 11 }), send("b", 20)];
		const next = applyScheduled(sends, { op: "update", send: { id: "a", at: 30, reset: "Anthropic 5h", target: start("edited") } }, 99);
		expect(next).toEqual([send("b", 20), { id: "a", at: 30, reset: "Anthropic 5h", target: start("edited"), createdAt: 1, state: { phase: "waiting" } }]);
	});

	test("refuses a send under way or gone, so the page does not believe the edit was saved", () => {
		const sends = [send("a", 10, { phase: "sending" })];
		const update = (id: string) => () => applyScheduled(sends, { op: "update", send: { id, at: 10, reset: null, target: start("x") } }, 99);
		expect(update("a")).toThrow("It is already sending.");
		expect(update("missing")).toThrow("It is no longer scheduled.");
	});
});

describe("parseScheduledSpec", () => {
	test("a continue saved without a cause followed a usage limit; one with a transient cause keeps it, and an unknown cause is dropped", () => {
		const continued = (cause?: unknown) => parseScheduledSpec({ id: "c", at: 10, reset: null, target: { kind: "continue", sessionId: "s1", provider: "Anthropic", reply: null, cause } });
		expect([continued(), continued("transient"), continued("outage")]).toEqual([
			{ ok: { id: "c", at: 10, reset: null, target: { kind: "continue", sessionId: "s1", provider: "Anthropic", cause: "usage-limit" } } },
			{ ok: { id: "c", at: 10, reset: null, target: { kind: "continue", sessionId: "s1", provider: "Anthropic", cause: "transient" } } },
			null,
		]);
	});
});
