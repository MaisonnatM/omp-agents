/** The Session card's **Subagents** section as a tree: which subagents a view lists, in what order, and how deep each sits. */
import type { AgentRow, ArenaRecord } from "../src/shared/sessions";

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

/** What the arena's pick made of a runner: the base, a graft into it, or not used. */
export type ArenaVerdict = { kind: "base" } | { kind: "graft"; what: string } | { kind: "unused" };

export interface ArenaSeat {
	/** `A` for the first runner the arena names, `B` for the next, and so on. */
	seat: string;
	agent: AgentRow;
	/** `null` before the pick. */
	verdict: ArenaVerdict | null;
}

export interface ArenaGroup {
	task: string;
	seats: ArenaSeat[];
	judge: AgentRow | null;
	/** The subagents the runners and the judge spawned, depth first, each one's depth counted from the arena's row, so a runner's child sits at 1. */
	descendants: SubagentNode[];
}

function verdictOf(arena: ArenaRecord, id: string): ArenaVerdict | null {
	if (arena.base === null) return null;
	if (arena.base === id) return { kind: "base" };
	const grafts = arena.grafts.filter(graft => graft.from === id).map(graft => graft.what);
	return grafts.length > 0 ? { kind: "graft", what: grafts.join(", ") } : { kind: "unused" };
}

/**
 * `nodes` split into the arenas whose runners they hold, each with its seats, judge, and the subagents those spawned, and the rest in their order.
 * An arena shows once two of its runners are among `nodes`, so a view of one subagent lists its own children plainly.
 * After the pick every seat has a verdict, even when the base runner is not among `nodes`.
 */
export function arenaGroups(nodes: readonly SubagentNode[], arenas: readonly ArenaRecord[]): { groups: ArenaGroup[]; rest: SubagentNode[] } {
	const byId = new Map(nodes.map(node => [node.agent.id, node.agent]));
	const owner = new Map<string, ArenaGroup>();
	const groups: ArenaGroup[] = [];
	for (const arena of arenas) {
		const seats = arena.runners.flatMap((id, index): ArenaSeat[] => {
			const agent = byId.get(id);
			return agent && !owner.has(id) ? [{ seat: String.fromCharCode(65 + index), agent, verdict: verdictOf(arena, id) }] : [];
		});
		if (seats.length < 2) continue;
		const judge = arena.judge === null || owner.has(arena.judge) ? null : (byId.get(arena.judge) ?? null);
		const group: ArenaGroup = { task: arena.task, seats, judge, descendants: [] };
		for (const { agent } of seats) owner.set(agent.id, group);
		if (judge) owner.set(judge.id, group);
		groups.push(group);
	}
	const rest: SubagentNode[] = [];
	// A seated runner or judge takes the rows after it that sit deeper, its own subtree in `subagentTree`'s order.
	let current: { group: ArenaGroup; depth: number } | null = null;
	for (const node of nodes) {
		const group = owner.get(node.agent.id);
		if (group) current = { group, depth: node.depth };
		else if (current && node.depth > current.depth) current.group.descendants.push({ agent: node.agent, depth: node.depth - current.depth });
		else {
			current = null;
			rest.push(node);
		}
	}
	return { groups, rest };
}
