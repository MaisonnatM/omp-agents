import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endedTurn, type TurnUpdate, turnUpdate } from "./live-session";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A session file holding `entries` after its header, one JSON line each. */
function sessionFile(entries: object[]): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-ended-"));
	dirs.push(dir);
	const path = join(dir, "session.jsonl");
	writeFileSync(path, [{ type: "session", id: "s1", cwd: dir }, ...entries].map(entry => `${JSON.stringify(entry)}\n`).join(""));
	return path;
}

const message = (timestamp: string, role: string, content: object[]) => ({ type: "message", timestamp, message: { role, content, timestamp: Date.parse(timestamp) } });
const text = (value: string) => ({ type: "text", text: value });

describe("endedTurn", () => {
	test("a turn that ended answers its last reply, without its suggestions, and the time of its last message, until its file is gone", () => {
		const path = sessionFile([
			message("2026-11-02T10:00:00.000Z", "user", [text("Fix the flaky test")]),
			message("2026-11-02T10:00:05.000Z", "assistant", [text("Earlier reply.")]),
			message("2026-11-02T10:01:00.000Z", "user", [text("Run the tests")]),
			message("2026-11-02T10:01:02.000Z", "assistant", [text("Running them."), { type: "toolCall", id: "t1", name: "bash", arguments: { command: "bun test" } }]),
			message("2026-11-02T10:01:10.000Z", "toolResult", [text("42 pass")]),
			message("2026-11-02T10:01:20.000Z", "assistant", [text("All green.\n\nSuggestions:\n1. Merge on main")]),
			{ type: "model_change", timestamp: "2026-11-02T10:02:00.000Z", provider: "anthropic", modelId: "claude" },
		]);
		expect(endedTurn(path)).toEqual({ at: Date.parse("2026-11-02T10:01:20.000Z"), reply: "All green." });
		rmSync(path);
		expect(endedTurn(path)).toBeNull();
	});

	test("stops at the turn's prompt, typed or a /skill: prompt, so an earlier turn's reply is never answered", () => {
		const typed = sessionFile([
			message("2026-11-02T10:00:00.000Z", "user", [text("Fix the flaky test")]),
			message("2026-11-02T10:00:05.000Z", "assistant", [text("Earlier reply.")]),
			message("2026-11-02T10:01:00.000Z", "user", [text("Run the tests")]),
			message("2026-11-02T10:01:02.000Z", "assistant", [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "bun test" } }]),
			message("2026-11-02T10:01:30.000Z", "assistant", [text("  ")]),
		]);
		expect(endedTurn(typed)).toEqual({ at: Date.parse("2026-11-02T10:01:30.000Z"), reply: null });

		const skill = sessionFile([
			message("2026-11-02T10:00:00.000Z", "user", [text("Fix the flaky test")]),
			message("2026-11-02T10:00:05.000Z", "assistant", [text("Earlier reply.")]),
			{ type: "custom_message", timestamp: "2026-11-02T10:01:00.000Z", customType: "skill-prompt", attribution: "user", content: "the skill", details: { name: "ship", args: "" } },
			message("2026-11-02T10:01:40.000Z", "assistant", [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } }]),
		]);
		expect(endedTurn(skill)).toEqual({ at: Date.parse("2026-11-02T10:01:40.000Z"), reply: null });
	});
});

describe("turnUpdate", () => {
	test("an agent_end ends the turn when it gives the turn back, terminal or waiting only on a background job, and not when more of the run follows", () => {
		const messages = [{ role: "assistant", content: [text("Started.")] }];
		const ended: TurnUpdate = { kind: "turn-ended", reply: "Started.", failure: null };
		expect(turnUpdate({ type: "agent_end", messages })).toEqual(ended);
		expect(turnUpdate({ type: "agent_end", isTerminal: false, yielded: true, awaitingAsyncWork: true, messages })).toEqual(ended);
		// omp keeps `yielded` on a terminal end it re-tags non-terminal for a queued follow-up.
		expect(turnUpdate({ type: "agent_end", isTerminal: false, yielded: true, messages })).toBeNull();
		expect(turnUpdate({ type: "agent_end", isTerminal: false, messages })).toBeNull();
	});
});
