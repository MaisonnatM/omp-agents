import { describe, expect, test } from "bun:test";
import { type AgentRow, EMPTY_QUEUE } from "../src/shared/sessions";
import { arenaGroups, type SubagentNode, subagentTree } from "./todos-card-subagents-model";

const agent = (id: string, parentId: string | null): AgentRow => ({ id, kind: "task", parentId, status: "running", activity: null, canMessage: true, queue: EMPTY_QUEUE });
const rows = (tree: SubagentNode[]) => tree.map(node => `${node.depth} ${node.agent.id}`);

// A child listed after a later sibling of its parent, as a registry in spawn order holds them.
const agents = [agent("A", null), agent("A.1", "A"), agent("B", null), agent("A.1.a", "A.1"), agent("A.2", "A"), agent("B.1", "B")];

describe("subagentTree", () => {
	test("from the session, lists every subagent depth first, each before its children, siblings in the list's order", () => {
		expect(rows(subagentTree(agents, null))).toEqual(["0 A", "1 A.1", "2 A.1.a", "1 A.2", "0 B", "1 B.1"]);
	});

	test("from a subagent, lists only its descendants, its children at depth 0", () => {
		expect(rows(subagentTree(agents, "A"))).toEqual(["0 A.1", "1 A.1.a", "0 A.2"]);
	});

	test("lists nothing with no subagents, or under a subagent that spawned none", () => {
		expect(rows(subagentTree([], null))).toEqual([]);
		expect(rows(subagentTree(agents, "A.2"))).toEqual([]);
		expect(rows(subagentTree(agents, "A.1"))).toEqual(["0 A.1.a"]);
	});
});

describe("arenaGroups", () => {
	const nodes = subagentTree([agent("Other", null), agent("RunA", null), agent("RunB", null), agent("RunC", null), agent("Judge", null)], null);
	const arena = { task: "Build it", runners: ["RunA", "RunB", "RunC"], judge: "Judge", base: null, grafts: [] };
	const seats = (group: { seats: { seat: string; agent: AgentRow; verdict: unknown }[] }) => group.seats.map(({ seat, agent, verdict }) => [seat, agent.id, verdict]);

	test("seats the runners in the arena's order, takes the judge out of the list, and leaves the rest in theirs", () => {
		const { groups, rest } = arenaGroups(nodes, [arena]);
		expect(groups.map(seats)).toEqual([[["A", "RunA", null], ["B", "RunB", null], ["C", "RunC", null]]]);
		expect(groups[0].judge?.id).toBe("Judge");
		expect(rest.map(node => node.agent.id)).toEqual(["Other"]);
	});

	test("after the pick, marks the base, each graft with what it gave, and the other runners not used", () => {
		const picked = { ...arena, base: "RunB", grafts: [{ from: "RunA", what: "Copy" }, { from: "RunA", what: "Tests" }] };
		const [group] = arenaGroups(nodes, [picked]).groups;
		expect(group.base).toBe("B");
		expect(seats(group)).toEqual([["A", "RunA", { kind: "graft", what: "Copy, Tests" }], ["B", "RunB", { kind: "base" }], ["C", "RunC", { kind: "unused" }]]);
	});

	test("an arena with fewer than two runners in the view stays plain rows, and keeps its letters when one is missing", () => {
		const two = nodes.filter(node => node.agent.id !== "RunA");
		expect(seats(arenaGroups(two, [arena]).groups[0])).toEqual([["B", "RunB", null], ["C", "RunC", null]]);
		const one = nodes.filter(node => node.agent.id === "RunA" || node.agent.id === "Other");
		expect(arenaGroups(one, [arena])).toEqual({ groups: [], rest: one });
	});
});
