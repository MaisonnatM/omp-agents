/** The Todos card's **Subagents** section as a tree: which subagents a view lists, in what order, and how deep each sits. */
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

/** What the arena's pick made of a runner: the base, a graft into it, or not used; `null` before the pick. */
export type ArenaVerdict = { kind: "base" } | { kind: "graft"; what: string } | { kind: "unused" } | null;

export interface ArenaSeat {
	/** `A` for the first runner the arena names, `B` for the next, and so on. */
	seat: string;
	agent: AgentRow;
	verdict: ArenaVerdict;
}

export interface ArenaGroup {
	task: string;
	seats: ArenaSeat[];
	judge: AgentRow | null;
	/** The base runner's seat; `null` before the pick. */
	base: string | null;
}

function verdictOf(arena: ArenaRecord, id: string): ArenaVerdict {
	if (arena.base === null) return null;
	if (arena.base === id) return { kind: "base" };
	const grafts = arena.grafts.filter(graft => graft.from === id).map(graft => graft.what);
	return grafts.length > 0 ? { kind: "graft", what: grafts.join(", ") } : { kind: "unused" };
}

/**
 * `nodes` split into the arenas whose runners they hold, each with its seats and judge, and the rest in their order.
 * An arena shows once two of its runners are among `nodes`, so a view of one subagent lists its own children plainly.
 */
export function arenaGroups(nodes: readonly SubagentNode[], arenas: readonly ArenaRecord[]): { groups: ArenaGroup[]; rest: SubagentNode[] } {
	const byId = new Map(nodes.map(node => [node.agent.id, node.agent]));
	const grouped = new Set<string>();
	const groups: ArenaGroup[] = [];
	for (const arena of arenas) {
		const seats = arena.runners.flatMap((id, index): ArenaSeat[] => {
			const agent = byId.get(id);
			return agent && !grouped.has(id) ? [{ seat: String.fromCharCode(65 + index), agent, verdict: verdictOf(arena, id) }] : [];
		});
		if (seats.length < 2) continue;
		const judge = arena.judge === null || grouped.has(arena.judge) ? null : (byId.get(arena.judge) ?? null);
		for (const { agent } of seats) grouped.add(agent.id);
		if (judge) grouped.add(judge.id);
		groups.push({ task: arena.task, seats, judge, base: seats.find(seat => seat.verdict?.kind === "base")?.seat ?? null });
	}
	return { groups, rest: nodes.filter(node => !grouped.has(node.agent.id)) };
}
