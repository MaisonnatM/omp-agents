import { describe, expect, test } from "bun:test";
import { PromptTurn } from "./prompt-turn";

const prompt = { id: "req_1", text: "say pong", images: [] };

describe("PromptTurn", () => {
	test("a prompt acked while idle is starting and busy until its user message shows, then the turn runs to its end", () => {
		const turn = new PromptTurn();
		const pending = turn.send();
		pending.close();
		pending.acked(prompt);
		expect(turn.starting).toBe(prompt);
		expect(turn.busy).toBe(true);
		turn.turnStarted();
		turn.shown();
		expect(turn.starting).toBeNull();
		expect(turn.running).toBe(true);
		turn.turnEnded();
		expect(turn.busy).toBe(false);
	});

	test("a prompt_result before or after the ack lets go of the prompt", () => {
		const early = new PromptTurn();
		const pending = early.send();
		early.result("req_1");
		pending.close();
		pending.acked(prompt);
		expect(early.starting).toBeNull();

		const late = new PromptTurn();
		late.send().acked(prompt);
		late.result("other");
		expect(late.starting).toBe(prompt);
		late.result("req_1");
		expect(late.starting).toBeNull();
	});

	test("a prompt sent while busy, whose turn started before its ack, or that omp ran itself is not held", () => {
		const running = new PromptTurn();
		running.turnStarted();
		running.send().acked(prompt);
		expect(running.starting).toBeNull();

		const raced = new PromptTurn();
		const pending = raced.send();
		raced.turnStarted();
		pending.acked(prompt);
		expect(raced.starting).toBeNull();

		const local = new PromptTurn();
		local.send().acked(null);
		expect(local.busy).toBe(false);
	});

	test("a stop hands the starting prompt back unless its turn showed it during the abort", () => {
		const unshown = new PromptTurn();
		unshown.send().acked(prompt);
		const mark = unshown.interrupt();
		unshown.release();
		expect(mark.unsent()).toEqual([prompt]);
		expect(unshown.starting).toBeNull();

		const shown = new PromptTurn();
		shown.send().acked(prompt);
		const shownMark = shown.interrupt();
		shown.shown();
		expect(shownMark.unsent()).toEqual([]);

		expect(new PromptTurn().interrupt().unsent()).toEqual([]);
	});
});
