/**
 * Posts each live session's turns on the Board, so the Board lists what waits for the user: when a session asks a
 * question, and when it finishes a turn that left a reply, it posts in its own thread in #sessions, mentioning the
 * user. The session is the author, and an agent's message wakes only the members it mentions, so no session wakes.
 * A Bot's conversation posts nothing: its routine runs would bury the rest.
 */
import { randomUUID } from "node:crypto";
import { type BoardChange, type BoardState, sessionMember } from "../shared/board";
import type { Bot } from "../shared/bots";
import type { RosterHost } from "../shared/sessions";

export const SESSIONS_CHANNEL = { id: "c-sessions", name: "sessions", about: "Each session's thread: what it asks you and when it finishes.", sync: null, restricted: false } as const;

export const sessionThreadId = (sessionId: string): string => `t-session-${sessionId}`;

export interface BoardFeedDeps {
	state(): BoardState;
	hosts(): readonly RosterHost[];
	bots(): readonly Bot[];
	apply(change: BoardChange): void;
	/** Whether this server posts at all: only the one that owns the files does. */
	active(): boolean;
	now(): number;
}

type Phase = "asking" | "working" | "idle";

const phaseOf = (host: RosterHost): Phase => {
	const presence = sessionMember(host).presence;
	return presence === "asking" ? "asking" : presence === "working" ? "working" : "idle";
};

/** What session `host` posts on moving from `before` to its phase now, or `null` for nothing. */
export function feedText(host: RosterHost, before: Phase | undefined, me: string): string | null {
	const now = phaseOf(host);
	if (now === before) return null;
	if (now === "asking") return `@${me} waits on you: ${host.requests[0]?.title ?? "a question"}`;
	if (now === "idle" && before === "working" && host.unread) return `@${me} finished: ${host.unread.reply ?? "its turn ended with no reply."}`;
	return null;
}

export class BoardFeed {
	readonly #deps: BoardFeedDeps;
	/** Each session's phase when last checked, so a post marks a change rather than a state. */
	readonly #phases = new Map<string, Phase>();

	constructor(deps: BoardFeedDeps) {
		this.#deps = deps;
	}

	/** Posts what changed for each live session since the last check; the server calls it on every roster change. */
	check(): void {
		const botSessions = new Set(this.#deps.bots().flatMap(bot => bot.sessionId ?? []));
		const hosts = this.#deps.hosts().filter(host => !botSessions.has(host.sessionId));
		const posts: { host: RosterHost; text: string }[] = [];
		for (const host of hosts) {
			const before = this.#phases.get(host.sessionId);
			this.#phases.set(host.sessionId, phaseOf(host));
			if (!this.#deps.active()) continue;
			const state = this.#deps.state();
			const me = state.extraMembers.find(member => member.id === state.me)?.name ?? "you";
			const text = feedText(host, before, me);
			if (text !== null) posts.push({ host, text });
		}
		const live = new Set(hosts.map(host => host.sessionId));
		for (const id of this.#phases.keys()) if (!live.has(id)) this.#phases.delete(id);
		for (const { host, text } of posts) this.#post(host, text);
	}

	#post(host: RosterHost, text: string): void {
		const state = this.#deps.state();
		const thread = sessionThreadId(host.sessionId);
		// A restart sees every asking session anew; the same question twice in a row is one post.
		const last = state.messages.findLast(msg => msg.thread === thread);
		if (last?.text === text) return;
		const at = this.#deps.now();
		// The user may have made a #sessions of their own; the feed posts there rather than fail on the name.
		let channel = state.channels.find(item => item.name === SESSIONS_CHANNEL.name)?.id;
		if (!channel) {
			channel = SESSIONS_CHANNEL.id;
			this.#deps.apply({ op: "channel", channel: { ...SESSIONS_CHANNEL } });
		}
		if (!state.threads.some(item => item.id === thread)) {
			this.#deps.apply({ op: "thread", thread: { id: thread, channel, title: sessionMember(host).name, task: null, lease: null, labels: [], blockedBy: [], createdAt: at } });
		}
		this.#deps.apply({ op: "post", message: { id: randomUUID(), thread, author: sessionMember(host).id, at, text } });
	}
}
