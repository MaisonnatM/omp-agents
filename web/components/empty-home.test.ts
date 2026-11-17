import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, test } from "bun:test";
import type { AgentRow, HostStatus, RosterHost, UnreadTurn, UserRequest } from "../../src/shared/sessions";
import { runningTasks } from "./empty-home";

const host = (
	instanceId: string,
	status: HostStatus,
	{ unread = null, requests = [], agents = [], turnWaits = false }: { unread?: UnreadTurn | null; requests?: UserRequest[]; agents?: AgentRow[]; turnWaits?: boolean } = {},
) => fromPartial<RosterHost>({ instanceId, sessionId: `s-${instanceId}`, sessionName: `Session ${instanceId}`, cwdDisplay: "~/code/webapp", status, unread, requests, agents, turnWaits });
const subagent = (status: AgentRow["status"]) => fromPartial<AgentRow>({ status });
const ask = (title: string): UserRequest => ({ id: "r1", title, deadline: null, kind: "select", options: [], checked: [] });

describe("runningTasks", () => {
	test("shows a working session as running, an ask or input as needing you, and an unseen turn as finished", () => {
		const tasks = runningTasks([
			host("works", "working"),
			host("asks", "needs-input", { requests: [ask("Which branch?")] }),
			host("input", "needs-input"),
			host("ended", "idle", { unread: { at: 1, reply: "Merged it." } }),
			host("read", "idle"),
		]);
		expect(tasks.map(({ id, state, step }) => [id, state, step])).toEqual([
			["works", "running", "Working…"],
			["asks", "needs-you", "Which branch?"],
			["input", "needs-you", "Waits for your input"],
			["ended", "done", "Merged it."],
		]);
	});

	test("counts finished subagents out of all of them as the task's steps", () => {
		const [task] = runningTasks([host("lead", "working", { agents: [subagent("running"), subagent("idle"), subagent("parked")] })]);
		expect([task?.done, task?.total]).toEqual([2, 3]);
	});
});
