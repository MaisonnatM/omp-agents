import { describe, expect, test } from "bun:test";
import { type BotMessage, botMessageText, readBotMessage } from "./bot-message";
import { type BotId, parseBotId } from "./bots";
import { type RoutineMessage, routineMessageText } from "./routine-message";
import { DASHBOARD_PROMPT_PREFIX, promptAuthor } from "./transcript";

const message: BotMessage = { from: parseBotId("triage") as BotId, name: "Triage", text: "Fix the flaky login test.\n\nIt fails on CI only." };

describe("readBotMessage", () => {
	test("reads back the message the sender's stamp carries, past trailing whitespace", () => {
		expect(readBotMessage(botMessageText(message))).toEqual(message);
		expect(readBotMessage(`${botMessageText(message)}\n  `)).toEqual(message);
	});

	test("reads the last stamp when a message quotes an earlier one", () => {
		const quoting: BotMessage = { ...message, text: `Forwarding this:\n\n${botMessageText({ ...message, name: "Other" })}` };
		expect(readBotMessage(botMessageText(quoting))).toEqual(quoting);
	});

	test("reads no message from text without a stamp, a stamp that is not last, one glued to a word, or one whose JSON is garbled or names no Bot", () => {
		const stamped = botMessageText(message);
		const stamp = stamped.slice(stamped.lastIndexOf("# omp-agents"));
		expect(readBotMessage("Fix the flaky login test.")).toBeNull();
		expect(readBotMessage(`${stamped}\nplease`)).toBeNull();
		expect(readBotMessage(`Fix it.word${stamp}`)).toBeNull();
		expect(readBotMessage(stamped.replace(/\{.*\}$/, '{"from":"triage","name":'))).toBeNull();
		expect(readBotMessage(stamped.replace(/\{.*\}$/, '{"from":"no such id!","name":"Triage"}'))).toBeNull();
		expect(readBotMessage(stamped.replace(/\{.*\}$/, '{"from":"triage","name":""}'))).toBeNull();
	});
});

describe("promptAuthor", () => {
	const routine: RoutineMessage = { botId: message.from, routine: { id: "r1", name: "Nightly" }, at: 1, triggeredBy: [], sent: { kind: "prompt", prompt: "Check CI." } };

	test("tells the dashboard's prompt first, then a routine's, then a Bot's, and calls the rest the user's", () => {
		expect(promptAuthor(`${DASHBOARD_PROMPT_PREFIX} ${botMessageText(message)}`)).toEqual({ kind: "dashboard" });
		expect(promptAuthor(routineMessageText({ ...routine, sent: { kind: "prompt", prompt: botMessageText(message) } }))).toEqual({ kind: "routine", message: { ...routine, sent: { kind: "prompt", prompt: botMessageText(message) } } });
		expect(promptAuthor(botMessageText({ ...message, text: routineMessageText(routine) }))).toEqual({ kind: "bot-message", message: { ...message, text: routineMessageText(routine) } });
		expect(promptAuthor(message.text)).toEqual({ kind: "user" });
	});
});
