/** The Todos card's **Subagents** section as a tree: which subagents a view lists, in what order, and how deep each sits. */
import type { AgentRow } from "../src/shared/sessions";

export interface SubagentNode {
	agent: AgentRow;
	/** 0 for a child of `root`, one more for each subagent between. */
	depth: number;
}

/**
 * The descendants of `root`, a subagent's id or `null` for the session's main agent, depth first: each subagent comes
 * right before the subagents it spawned, and siblings keep the order `agents` holds them in.
 */
export function subagentTree(agents: readonly AgentRow[], root: string | null): SubagentNode[] {
	const children = new Map<string | null, AgentRow[]>();
	for (const agent of agents) {
		const siblings = children.get(agent.parentId);
		if (siblings) siblings.push(agent);
		else children.set(agent.parentId, [agent]);
	}
	const nodes: SubagentNode[] = [];
	const visit = (parent: string | null, depth: number): void => {
		for (const agent of children.get(parent) ?? []) {
			nodes.push({ agent, depth });
			visit(agent.id, depth + 1);
		}
	};
	visit(root, 0);
	return nodes;
}
