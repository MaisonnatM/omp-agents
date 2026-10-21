/**
 * The page's **Ask about this** discussion: one at a time, kept in memory for this page load only. Each question is one
 * `discuss` over the socket, whose `discussion` events fill in its answer.
 */
import { useSyncExternalStore } from "react";
import { type DiscussionEvent, type DiscussionRequest, MAX_DISCUSSION_QUOTE, MAX_DISCUSSION_SOURCE } from "../src/shared/discussions";
import type { ClientMsg, ServerMsg } from "../src/shared/protocol";

/** Where a selected passage came from, and where **Send to session** takes it. */
export interface DiscussionOrigin {
	/** Shown in the panel and sent to the model: `session “Fix the login bug”`, or a pull request with its file. */
	source: string;
	quote: string;
	/** Queues a message in the live session the passage came from; `null` for a past session or a pull request, which offer none. */
	sendToSession: ((text: string) => Promise<void>) | null;
}

/** One question and its answer so far. */
export interface AskedTurn {
	/** The `discuss` id it went out with, counted per page. */
	id: number;
	question: string;
	answer: string;
	/** The `provider/id` that answers, once the server named it. */
	model: string | null;
	/** `stopped` once you stopped it, `failed` with `error` once the server said why it could not answer. */
	status: "streaming" | "done" | "stopped" | "failed";
	error: string | null;
}

export interface Discussion extends DiscussionOrigin {
	/** Counts the discussions opened in this page load, so asking about the same passage again starts afresh. */
	opened: number;
	turns: AskedTurn[];
}

/** A selection as the discussion quotes it: trimmed, and cut to what the server takes. */
export const quoteOf = (selected: string): string => selected.trim().slice(0, MAX_DISCUSSION_QUOTE);

/** A turn a follow-up carries back: answered in full. A stopped or failed answer is left out, as the model never finished it. */
const answered = (turn: AskedTurn): boolean => turn.status === "done" && turn.answer.trim() !== "";

/** What `question` sends: the passage, its source, and the questions answered before, nothing else of the page. */
export function discussionRequest({ source, quote, turns }: Discussion, question: string): DiscussionRequest {
	return {
		source: source.slice(0, MAX_DISCUSSION_SOURCE),
		quote,
		turns: turns.filter(answered).map(turn => ({ question: turn.question, answer: turn.answer })),
		question: question.trim(),
	};
}

/** `discussion` after `event` for its question `id`; an event for a question it no longer holds changes nothing. */
export function withEvent(discussion: Discussion, id: number, event: DiscussionEvent): Discussion {
	const at = discussion.turns.findIndex(turn => turn.id === id);
	const turn = discussion.turns[at];
	if (!turn || turn.status !== "streaming") return discussion;
	const next: AskedTurn =
		event.kind === "model"
			? { ...turn, model: event.model }
			: event.kind === "text"
				? { ...turn, answer: turn.answer + event.text }
				: { ...turn, status: event.error === null ? "done" : "failed", error: event.error };
	return { ...discussion, turns: discussion.turns.with(at, next) };
}

/** The last full answer, which **Send to session** concludes with, and the question it answered. */
export const conclusion = (discussion: Discussion): AskedTurn | null => discussion.turns.findLast(answered) ?? null;

let current: Discussion | null = null;
let nextId = 0;
let opened = 0;
const listeners = new Set<() => void>();

function set(next: Discussion | null): void {
	current = next;
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const read = (): Discussion | null => current;

/** The open discussion, `null` while none is open. */
export const useDiscussion = (): Discussion | null => useSyncExternalStore(subscribe, read, read);

type Send = (msg: ClientMsg) => void;

/** Stops the answer still streaming, if one is. */
function stopRunning(send: Send): void {
	const running = current?.turns.find(turn => turn.status === "streaming");
	if (!running || !current) return;
	send({ t: "discuss-stop", id: running.id });
	set({ ...current, turns: current.turns.map(turn => (turn === running ? { ...turn, status: "stopped" } : turn)) });
}

/** Opens a discussion of `origin`'s passage, replacing the one open. */
export function openDiscussion(origin: DiscussionOrigin, send: Send): void {
	stopRunning(send);
	set({ ...origin, opened: opened++, turns: [] });
}

/** Asks `question` about the open passage. */
export function askDiscussion(question: string, send: Send): void {
	if (!current || question.trim() === "") return;
	stopRunning(send);
	const id = nextId++;
	send({ t: "discuss", id, request: discussionRequest(current, question) });
	set({ ...current, turns: [...current.turns, { id, question: question.trim(), answer: "", model: null, status: "streaming", error: null }] });
}

export const stopDiscussion = stopRunning;

/** Closes the discussion, stopping its answer; nothing of it is kept. */
export function closeDiscussion(send: Send): void {
	stopRunning(send);
	set(null);
}

/** A `discussion` event from the server. */
export function applyDiscussionMessage({ id, event }: Extract<ServerMsg, { t: "discussion" }>): void {
	if (current) set(withEvent(current, id, event));
}

/** The socket closed, and the server stops every answer it was streaming to it. */
export function discussionDisconnected(): void {
	if (!current?.turns.some(turn => turn.status === "streaming")) return;
	set({ ...current, turns: current.turns.map(turn => (turn.status === "streaming" ? { ...turn, status: "failed", error: "Lost the connection to the server." } : turn)) });
}
