/**
 * Turns the Board's unread messages into turns: each new message is sent, as a follow-up, to every omp session and Bot
 * it is for, which resumes a session that ended and starts a Bot's conversation it has not had yet; and a schedule that
 * comes due is posted. A message is for a member when it mentions it, or when a person writes in a thread the member
 * posted in; an agent's message wakes only the members it mentions, so two agents in one thread do not wake each other
 * forever.
 */
import { randomUUID } from "node:crypto";
import { type BoardState, boardMembers, isMention, type Member, type Message } from "../shared/board";
import type { BoardEnv } from "../board-module";

/** What waking reads and does. */
export type BoardWakeDeps = Omit<BoardEnv, "stopping">;

/** The sessions and Bots `msg` wakes, among `members`. */
export function wakeTargets(state: BoardState, members: readonly Member[], msg: Message): Member[] {
	const author = members.find(member => member.id === msg.author);
	const byPerson = author?.kind === "human";
	return members.filter(member => {
		if ((!member.sessionId && !member.botId) || member.id === msg.author || msg.internal) return false;
		if (isMention(msg.text, member)) return true;
		return byPerson && state.messages.some(other => other.thread === msg.thread && other.author === member.id);
	});
}

/** What a woken session reads: where the message is, who wrote it, and how to answer. */
export function wakePrompt(state: BoardState, members: readonly Member[], msg: Message): string {
	const thread = state.threads.find(item => item.id === msg.thread);
	const channel = state.channels.find(item => item.id === thread?.channel);
	const author = members.find(member => member.id === msg.author)?.name ?? msg.author;
	const lines = [`New Board message for you in #${channel?.name ?? "?"} › "${thread?.title ?? msg.thread}" (thread ${msg.thread}), from ${author}:`, "", ...msg.text.split("\n").map(line => `> ${line}`)];
	if (msg.attachment?.kind === "workflow") {
		lines.push("", `It runs the ${msg.attachment.command} workflow, message ${msg.id}. Work through its steps in order, and report each with the board tool's progress action:`);
		msg.attachment.steps.forEach((step, i) => lines.push(`${i}. ${step.label}`));
	}
	lines.push("", `Answer in the thread with the board tool: action "post", thread "${msg.thread}". Read the whole thread first with action "read" when you need its context.`);
	return lines.join("\n");
}

export class BoardWake {
	readonly #deps: BoardWakeDeps;
	/** The messages already handled, so each wakes its sessions once. */
	readonly #seen: Set<string>;

	constructor(deps: BoardWakeDeps) {
		this.#deps = deps;
		this.#seen = new Set(deps.state().messages.map(msg => msg.id));
	}

	/** Wakes the sessions and Bots each new message is for; the server calls it after every Board change. */
	check(): void {
		const state = this.#deps.state();
		const fresh = state.messages.filter(msg => !this.#seen.has(msg.id));
		for (const msg of fresh) this.#seen.add(msg.id);
		if (fresh.length === 0 || !this.#deps.active()) return;
		const members = boardMembers(state, this.#deps.hosts(), this.#deps.bots());
		const kept = new Set(state.extraMembers.map(member => member.id));
		for (const msg of fresh) {
			const targets = wakeTargets(state, members, msg);
			const author = members.find(member => member.id === msg.author);
			// A session or Bot that posts or is mentioned stays a member once it ends, so a later mention resumes it.
			for (const member of [...targets, ...(author?.sessionId || author?.botId ? [author] : [])]) {
				if (kept.has(member.id)) continue;
				kept.add(member.id);
				this.#deps.apply({ op: "member", member: { ...member, presence: "asleep" } });
			}
			for (const target of targets) {
				const prompt = wakePrompt(state, members, msg);
				const woken = target.botId ? this.#deps.wakeBot(target.botId, prompt) : this.#deps.wake(target.sessionId!, prompt);
				woken.catch(err => console.error(`The Board could not wake ${target.name}:`, err));
			}
		}
	}

	/** Posts every schedule that came due. */
	fireDue(): void {
		if (!this.#deps.active()) return;
		const now = this.#deps.now();
		for (const schedule of this.#deps.state().schedules) {
			if (schedule.at <= now) this.#deps.apply({ op: "fire", schedule: schedule.id, message: randomUUID(), at: now });
		}
	}
}
