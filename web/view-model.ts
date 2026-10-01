/** Pure transforms from server messages to what the page renders. */
import type { AgentRow, Item, PastSession, RosterHost, View } from "../src/shared";

export type ToolItem = Extract<Item, { kind: "tool" }>;

/** Consecutive tool calls render as one activity group between messages. */
export type Block = { kind: "item"; item: Exclude<Item, ToolItem> } | { kind: "tools"; id: string; tools: ToolItem[] };

export interface AgentNode {
	agent: AgentRow;
	/** 0 for subagents of the main agent, 1 for their children, and so on. */
	depth: number;
}

const PAST_PREFIX = "past/";

/**
 * `#<instanceId>` selects a live session, `#<instanceId>/<agentId>` one of its subagents,
 * and `#past/<sessionId>` a past session. Instance ids are hex, so none reads as `past`.
 */
export function viewFromHash(hash: string): View | null {
	const raw = hash.replace(/^#/, "");
	if (!raw) return null;
	if (raw.startsWith(PAST_PREFIX)) return { kind: "past", sessionId: decodeURIComponent(raw.slice(PAST_PREFIX.length)) };
	const slash = raw.indexOf("/");
	if (slash < 0) return { kind: "live", instanceId: decodeURIComponent(raw), agentId: null };
	return {
		kind: "live",
		instanceId: decodeURIComponent(raw.slice(0, slash)),
		agentId: decodeURIComponent(raw.slice(slash + 1)),
	};
}

export function hashForView(view: View): string {
	if (view.kind === "past") return `#${PAST_PREFIX}${encodeURIComponent(view.sessionId)}`;
	const session = encodeURIComponent(view.instanceId);
	return view.agentId === null ? `#${session}` : `#${session}/${encodeURIComponent(view.agentId)}`;
}

export const sameView = (a: View | null, b: View | null): boolean =>
	(a && hashForView(a)) === (b && hashForView(b));

/**
 * Where a new session starts unless the user types another directory: the open session's,
 * else the newest live one's, else the newest past one's.
 */
export function defaultCwd(view: View | null, hosts: RosterHost[], past: PastSession[]): string {
	const open =
		view?.kind === "live"
			? hosts.find(host => host.instanceId === view.instanceId)
			: past.find(session => session.sessionId === view?.sessionId);
	const newestHost = hosts.toSorted((a, b) => b.startedAt - a.startedAt)[0];
	// Sessions from old omp versions recorded no directory.
	const candidates = [open, newestHost, ...past].map(row => row?.cwdDisplay).filter(Boolean);
	return candidates[0] ?? "~";
}

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

/** Where a message forks. omp branches only at a user prompt, keeping the history before it. */
export interface ForkPoint {
	entryId: string;
	/** Forking a prompt starts the composer with it to edit; forking a reply starts it empty. */
	prefill: boolean;
}

/**
 * Fork points by item id. A prompt forks at itself. A turn's last reply forks at the next prompt,
 * keeping the whole turn; earlier replies in the turn, a reply still streaming, and a reply no
 * forkable prompt follows have none.
 */
export function forkPoints(items: Item[]): Map<string, ForkPoint> {
	const points = new Map<string, ForkPoint>();
	let nextPrompt: string | null = null;
	let replyFound = false;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.kind === "user") {
			nextPrompt = item.entryId;
			replyFound = false;
			if (item.entryId) points.set(item.id, { entryId: item.entryId, prefill: true });
		} else if (item.kind === "assistant" && !replyFound) {
			replyFound = true;
			if (nextPrompt && !item.streaming) points.set(item.id, { entryId: nextPrompt, prefill: false });
		}
	}
	return points;
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
