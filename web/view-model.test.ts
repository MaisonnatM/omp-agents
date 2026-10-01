import { describe, expect, test } from "bun:test";
import type { AgentRow, Item } from "../src/shared";
import { agentTree, applyItems, hashForView, toBlocks, viewFromHash } from "./view-model";

const agent = (id: string, parentId: string | null): AgentRow => ({
	id,
	kind: "task",
	parentId,
	status: "running",
	activity: null,
	canMessage: true,
});

describe("agentTree", () => {
	test("orders children under their parent with increasing depth", () => {
		const nodes = agentTree([agent("B", null), agent("A1", "A"), agent("A", null), agent("A1a", "A1")]);
		expect(nodes.map(({ agent, depth }) => `${agent.id}:${depth}`)).toEqual(["B:0", "A:0", "A1:1", "A1a:2"]);
	});

	test("a child whose parent is not listed becomes a top-level row", () => {
		expect(agentTree([agent("Orphan", "Gone")]).map(({ agent, depth }) => `${agent.id}:${depth}`)).toEqual(["Orphan:0"]);
	});
});

describe("view hash", () => {
	test("round-trips session and subagent views, including ids that need escaping", () => {
		const view = { instanceId: "7c51f77b2a1bf7ba", agentId: "Parent/Child #2" };
		expect(viewFromHash(hashForView(view))).toEqual(view);
		expect(viewFromHash("#7c51f77b2a1bf7ba")).toEqual({ instanceId: "7c51f77b2a1bf7ba", agentId: null });
		expect(viewFromHash("")).toBeNull();
	});
});

describe("transcript rendering", () => {
	const user: Item = { id: "u", kind: "user", text: "go", from: null };
	const tool = (id: string, status: "running" | "ok"): Item => ({ id, kind: "tool", name: "bash", summary: "ls", status });

	test("upserts keep position and append new ids", () => {
		const items = applyItems([user, tool("t1", "running")], false, [tool("t1", "ok"), tool("t2", "running")]);
		expect(items.map(item => (item.kind === "tool" ? `${item.id}:${item.status}` : item.id))).toEqual(["u", "t1:ok", "t2:running"]);
	});

	test("consecutive tools group into one block; a message splits groups", () => {
		const blocks = toBlocks([tool("t1", "ok"), tool("t2", "ok"), user, tool("t3", "running")]);
		expect(blocks.map(block => (block.kind === "tools" ? block.tools.map(t => t.id).join("+") : block.item.id))).toEqual([
			"t1+t2",
			"u",
			"t3",
		]);
	});
});
