import { describe, expect, test } from "bun:test";
import { type AgentRow, EMPTY_QUEUE } from "../src/shared/sessions";
import { type SubagentNode, subagentTree } from "./todos-card-subagents-model";

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
