import { describe, expect, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { BotId } from "../shared/bots";
import type { ScheduledChange } from "../shared/scheduled";
import { newSessionRequest, type RosterHost, type StartRequest } from "../shared/sessions";
import { SessionFollowUps } from "./session-follow-ups";

const NOW = 1_700_000_000_000;

function setup() {
	const hosts = [fromPartial<RosterHost>({ instanceId: "i1", sessionId: "s-i1" })];
	const scheduled: ScheduledChange[] = [];
	const followUps = new SessionFollowUps({
		hosts: () => hosts,
		isBot: request => request.kind === "new" && request.bot !== null,
		schedule: change => {
			scheduled.push(change);
			return true;
		},
		now: () => NOW,
	});
	const call = (args: Record<string, unknown>, caller = "i1") =>
		followUps.join(newSessionRequest("/tmp", "Hi"), caller).rpc.tools[0]!.execute(args, { toolCallId: "c1", signal: new AbortController().signal });
	return { followUps, scheduled, call };
}

describe("the schedule_follow_up tool", () => {
	test("every dashboard start gets it but a Bot's conversation", () => {
		const { followUps } = setup();
		const toolsOf = (request: StartRequest) => followUps.join(request, "i1").rpc.tools.map(tool => tool.name);
		expect(toolsOf(newSessionRequest("/tmp", "Hi"))).toEqual(["schedule_follow_up"]);
		expect(toolsOf({ kind: "resume", sessionId: "s1" })).toEqual(["schedule_follow_up"]);
		expect(toolsOf(newSessionRequest("/tmp", "Hi", { bot: "scout" as BotId }))).toEqual([]);
	});

	test("schedules the message to the caller's own session at the asked time", async () => {
		const { scheduled, call } = setup();
		const answer = await call({ message: "Check CI on #12", in_minutes: 5 });
		expect(scheduled).toEqual([
			{ op: "add", send: { id: expect.any(String), at: NOW + 5 * 60_000, reset: null, target: { kind: "message", sessionId: "s-i1", text: "Check CI on #12" } } },
		]);
		expect(answer).toContain(new Date(NOW + 5 * 60_000).toISOString());
	});

	test("refuses an empty message, a delay out of range, and a caller not listed yet, scheduling nothing", async () => {
		const { scheduled, call } = setup();
		expect(call({ message: "  ", in_minutes: 5 })).rejects.toThrow("message must be a non-empty text.");
		expect(call({ message: "Check", in_minutes: 0 })).rejects.toThrow("in_minutes must be from 1 to 10080.");
		expect(call({ message: "Check", in_minutes: 10081 })).rejects.toThrow("in_minutes must be from 1 to 10080.");
		expect(call({ message: "Check", in_minutes: 5 }, "i9")).rejects.toThrow("This session is not listed yet");
		expect(scheduled).toEqual([]);
	});
});
