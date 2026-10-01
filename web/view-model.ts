/** Pure transforms from server messages to what the page renders. */
import type { AgentRow, Item, View } from "../src/shared";

export type ToolItem = Extract<Item, { kind: "tool" }>;

/** Consecutive tool calls render as one activity group between messages. */
export type Block = { kind: "item"; item: Exclude<Item, ToolItem> } | { kind: "tools"; id: string; tools: ToolItem[] };

export interface AgentNode {
	agent: AgentRow;
	/** 0 for subagents of the main agent, 1 for their children, and so on. */
	depth: number;
}

/** `#<instanceId>` selects a session, `#<instanceId>/<agentId>` one of its subagents. */
export function viewFromHash(hash: string): View | null {
	const raw = hash.replace(/^#/, "");
	if (!raw) return null;
	const slash = raw.indexOf("/");
	if (slash < 0) return { instanceId: decodeURIComponent(raw), agentId: null };
	return { instanceId: decodeURIComponent(raw.slice(0, slash)), agentId: decodeURIComponent(raw.slice(slash + 1)) };
}

export function hashForView(view: View): string {
	const session = encodeURIComponent(view.instanceId);
	return view.agentId === null ? `#${session}` : `#${session}/${encodeURIComponent(view.agentId)}`;
}

export const sameView = (a: View | null, b: View | null): boolean =>
	a?.instanceId === b?.instanceId && a?.agentId === b?.agentId;

/** Apply an `items` message: replace on reset, else upsert by id and append new ids. */
export function applyItems(prev: Item[], reset: boolean, items: Item[]): Item[] {
	if (reset) return items;
	const next = [...prev];
	const index = new Map(next.map((item, i) => [item.id, i]));
	for (const item of items) {
		const at = index.get(item.id);
		if (at === undefined) {
			index.set(item.id, next.length);
			next.push(item);
		} else {
			next[at] = item;
		}
	}
	return next;
}

export function toBlocks(items: Item[]): Block[] {
	const blocks: Block[] = [];
	for (const item of items) {
		const last = blocks.at(-1);
		if (item.kind !== "tool") blocks.push({ kind: "item", item });
		else if (last?.kind === "tools") last.tools.push(item);
		else blocks.push({ kind: "tools", id: item.id, tools: [item] });
	}
	return blocks;
}

/** Depth-first parent/child order. Rows whose parent is not listed start a top-level branch. */
export function agentTree(agents: AgentRow[]): AgentNode[] {
	const ids = new Set(agents.map(agent => agent.id));
	const children = new Map<string | null, AgentRow[]>();
	for (const agent of agents) {
		const parent = agent.parentId !== null && ids.has(agent.parentId) ? agent.parentId : null;
		children.set(parent, [...(children.get(parent) ?? []), agent]);
	}
	const out: AgentNode[] = [];
	const visit = (parent: string | null, depth: number): void => {
		for (const agent of children.get(parent) ?? []) {
			out.push({ agent, depth });
			visit(agent.id, depth + 1);
		}
	};
	visit(null, 0);
	return out;
}
