import { describe, expect, test } from "bun:test";
import { type BotId, parseBotId } from "./bots";
import { type RoutineMessage, readRoutineMessage, routineMessageText } from "./routine-message";

const botId = parseBotId("build-bot") as BotId;
const head = { botId, routine: { id: "nightly", name: "Nightly build" }, at: 1_700_000_000_000, triggeredBy: [] };
const prompt: RoutineMessage = { ...head, sent: { kind: "prompt", prompt: "/skill:triage check the inbox" } };
const exited: RoutineMessage = {
	...head,
	triggeredBy: [{ kind: "slack", title: "#builds", detail: "rerun please", url: "https://slack.com/archives/C1/p1" }],
	sent: { kind: "command", command: "bun run build", run: { phase: "exited", code: 2, output: "```\nboom\n```", startedAt: 1, endedAt: 2 } },
};
const failed: RoutineMessage = { ...head, sent: { kind: "command", command: "make", run: { phase: "failed", error: "no such directory", startedAt: 1, endedAt: 1 } } };
const stopped: RoutineMessage = { ...head, sent: { kind: "command", command: "sleep 9999", run: { phase: "stopped", reason: "time-limit", output: "", startedAt: 1, endedAt: 9 } } };

describe("readRoutineMessage", () => {
	test.each([
		["prompt", prompt],
		["exited command with backticks in its output", exited],
		["command that could not start", failed],
		["stopped command that printed nothing", stopped],
	])("reads back the %s the runner sent", (_, message) => {
		expect(readRoutineMessage(routineMessageText(message))).toEqual(message);
	});

	test("reads a skill prompt whose blank line before the stamp omp trimmed", () => {
		const text = routineMessageText(prompt).replace("\n\n#", " #");
		expect(readRoutineMessage(text)).toEqual(prompt);
	});

	test("ignores trailing whitespace after the stamp", () => {
		expect(readRoutineMessage(`${routineMessageText(prompt)}\n  `)).toEqual(prompt);
	});

	test("reads the last stamp when a prompt quotes an earlier one", () => {
		const quoting: RoutineMessage = { ...prompt, sent: { kind: "prompt", prompt: routineMessageText(exited) } };
		expect(readRoutineMessage(routineMessageText(quoting))).toEqual(quoting);
	});

	test("treats a user message without a stamp as the user's", () => {
		expect(readRoutineMessage("Run the nightly build please")).toBeNull();
	});

	test("rejects a stamp that is not the end of the text", () => {
		expect(readRoutineMessage(`${routineMessageText(prompt)}\nand one more thing`)).toBeNull();
	});

	test("rejects a stamp glued to a word", () => {
		expect(readRoutineMessage(routineMessageText(prompt).replace("\n\n#", "x#"))).toBeNull();
	});

	test("rejects a command whose report was edited", () => {
		expect(readRoutineMessage(routineMessageText(exited).replace("exited with code 2", "exited with code 0"))).toBeNull();
	});

	test("rejects a command stamp claiming a different exit than its report", () => {
		expect(readRoutineMessage(routineMessageText(exited).replace('"code":2', '"code":0'))).toBeNull();
	});

	test.each([
		["malformed JSON", (stamp: string) => stamp.replace(/\}$/, "")],
		["a missing routine name", (stamp: string) => stamp.replace('"name":"Nightly build"', '"name":""')],
		["an invalid Bot id", (stamp: string) => stamp.replace('"botId":"build-bot"', '"botId":"../etc"')],
		["a fractional run key", (stamp: string) => stamp.replace('"at":1700000000000', '"at":1.5')],
		["an end without a command", (stamp: string) => stamp.replace(/\}$/, ',"end":{"phase":"failed"}}')],
	])("rejects a stamp with %s", (_, damage) => {
		expect(readRoutineMessage(damage(routineMessageText(prompt)))).toBeNull();
	});
});
