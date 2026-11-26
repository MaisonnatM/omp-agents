/**
 * The turn the session on a routine's Board task took on one run, read from the Board and that session's file: the
 * routine's usage and its daily heartbeat both read it.
 */
import { isObject } from "../json";
import { turnFailureOf } from "../omp/turn-failure";
import type { RunTurn } from "../routine-health";
import { entryTime, tailEntries } from "../session-entries";
import type { BoardState } from "../../templates/omp/agent/extensions/board/log";

/** What `messages`, assistant messages among them, spent: their tokens, input, output, and cache together, and their cost in dollars. */
function usageOf(messages: readonly unknown[]): RunTurn["usage"] {
	let tokens = 0;
	let cost = 0;
	for (const message of messages) {
		if (!isObject(message) || message.role !== "assistant" || !isObject(message.usage)) continue;
		const { usage } = message;
		for (const key of ["input", "output", "cacheRead", "cacheWrite"]) tokens += typeof usage[key] === "number" ? usage[key] : 0;
		cost += isObject(usage.cost) && typeof usage.cost.total === "number" ? usage.cost.total : 0;
	}
	return { tokens, cost };
}

/**
 * The turn the session on Board task `task` of `board` took on the run at `at`: from what the run posted, the Board task
 * or the routine's reply on it, to the first done after that, which ends the turn, or to the first time a session left
 * it without marking it done. `pathOf` finds a session's file. `null` while neither happened, or when the Board task or
 * the run's reply is gone.
 */
export function boardRunTurn(board: BoardState, task: number, at: number, pathOf: (sessionId: string) => string | null): RunTurn | null {
	const found = board.tasks.find(candidate => candidate.id === task);
	if (!found) return null;
	const reply = found.at >= at ? -1 : found.replies.findIndex(entry => entry.at >= at && "by" in entry && entry.by.kind === "routine");
	if (found.at < at && reply === -1) return null;
	const end = found.replies.slice(reply + 1).find(entry => "note" in entry && (entry.note.kind === "done" || entry.note.kind === "expired" || entry.note.kind === "unclaimed"));
	if (!end || !("note" in end)) return null;
	const { note } = end;
	const sessionId = note.kind === "done" || note.kind === "expired" || note.kind === "unclaimed" ? note.sessionId : null;
	const messages: unknown[] = [];
	const path = sessionId === null ? null : pathOf(sessionId);
	if (path !== null) {
		try {
			for (const entry of tailEntries(path)) {
				const time = entryTime(entry);
				if (time !== null && time < at) break;
				if (entry.type === "message" && isObject(entry.message) && (time === null || time <= end.at)) messages.push(entry.message);
			}
		} catch {}
	}
	const ordered = messages.toReversed();
	return {
		replied: note.kind === "done",
		quiet: note.kind === "done" && note.quiet === true,
		failed: turnFailureOf(ordered) !== null,
		ms: end.at - at,
		usage: usageOf(ordered),
	};
}
