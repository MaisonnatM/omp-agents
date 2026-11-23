import { fromPartial } from "@total-typescript/shoehorn";
import { expect, test } from "bun:test";
import type { ProjectChannel } from "../src/shared/board";
import type { PastSession, RosterHost } from "../src/shared/sessions";
import { listedViews, projectGroups, sidebarSessions, workspaceGroups } from "./sessions";

const host = (sessionId: string, cwd: string) => fromPartial<RosterHost>({ instanceId: `i-${sessionId}`, sessionId, cwd, agents: [], turnWaits: false });
const past = (sessionId: string, cwd: string, interrupted: boolean) => ({ sessionId, cwd, interrupted }) as PastSession;
const ids = (rows: { sessionId: string }[]) => rows.map(row => row.sessionId);

test("a session in a project channel leaves Pinned and its workspace's folder for its project's, across workspaces, and its rows walk first", () => {
	const workspace = (cwd: string) => ({ cwd, cwdDisplay: cwd });
	const live = [{ ...host("h1", "~/a"), status: "idle" as const }, { ...host("h2", "~/b"), status: "working" as const }, { ...host("h3", "~/a"), status: "idle" as const }];
	const lists = sidebarSessions(live, [past("p1", "~/a", true), past("p2", "~/b", false)], null, new Set(["h3"]));
	const project = fromPartial<ProjectChannel>({ id: "x", name: "launch", about: "", project: { goal: "", decisions: [], sessionIds: ["h2", "p1", "p2", "h3"], createdAt: 0 } });
	const { groups: projects, rest } = projectGroups(lists, [project]);
	expect(projects.map(group => [ids(group.hosts), ids(group.past)])).toEqual([[["h3", "h2"], ["p1"]]]);
	expect(ids(rest.pinned.hosts)).toEqual([]);
	expect(ids(rest.ended)).toEqual(["p2"]);
	const groups = workspaceGroups(rest, [workspace("~/a"), workspace("~/b")]);
	expect(groups.map(group => [group.workspace.cwd, ids(group.hosts), ids(group.interrupted)])).toEqual([["~/a", ["h1"], []], ["~/b", [], []]]);
	expect(listedViews(rest, projects, groups).slice(0, 3)).toEqual([
		{ kind: "live", instanceId: "i-h3", agentId: null },
		{ kind: "live", instanceId: "i-h2", agentId: null },
		{ kind: "past", sessionId: "p1" },
	]);
	expect(projectGroups(lists, []).rest).toBe(lists);
});
