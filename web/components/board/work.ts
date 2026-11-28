/** What the Board page and its sidebar read from a Board task beyond its fold: how its work stands, and which session its thread shows. */
import { PROJECT_CODE_KINDS, type ProjectCodeKind, type TrustAsk } from "../../../src/shared/project-trust";
import { type RosterHost, type Stop, stopOf } from "../../../src/shared/sessions";
import { type BoardState, type BoardTask, startedOn, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";

/**
 * Where a Board task in work stands: its session starting, held from starting for `reason`, such as memory pressure, its
 * last start failed with `error`, and `trust` when the project's untrusted agent code refused it, its session working,
 * or its session stopped for you, as `stopOf` says.
 */
export type Work = { kind: "starting" } | { kind: "held"; reason: string } | { kind: "failed"; error: string; trust?: TrustAsk } | { kind: "working"; sessionId: string } | { kind: "waiting"; sessionId: string; stop: Stop };

const isCodeKind = (kind: string): kind is ProjectCodeKind => PROJECT_CODE_KINDS.some(each => each === kind);

/** Board task `task`'s {@link Work}, `null` once it is done or waits on another Board task; `held` is why the server holds ready Board tasks from starting, `null` when it does not. */
export function workOf(state: BoardState, task: BoardTask, hosts: readonly RosterHost[], held: string | null = null): Work | null {
	const status = statusOf(state, task);
	if (status.kind === "failed") {
		// The trust dialog's ask leaves out a piece of a kind this page does not know, from a newer server.
		const trust = status.trust && { ...status.trust, code: status.trust.code.flatMap(piece => (isCodeKind(piece.kind) ? [{ ...piece, kind: piece.kind }] : [])) };
		return { kind: "failed", error: status.error, ...(trust ? { trust } : {}) };
	}
	if (status.kind !== "ready" && status.kind !== "claimed") return null;
	const sessionId = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	if (sessionId === null) return held === null ? { kind: "starting" } : { kind: "held", reason: held };
	const host = hosts.find(each => each.sessionId === sessionId);
	const stop = host ? stopOf(host) : null;
	return stop ? { kind: "waiting", sessionId, stop } : { kind: "working", sessionId };
}

/** The sessions Board task `task` names: who posted it, replied to it, was started on it, or claimed it. */
export function namedIn(task: BoardTask): string[] {
	const ids: string[] = [];
	if (task.by.kind === "session") ids.push(task.by.sessionId);
	for (const entry of task.replies) {
		if ("by" in entry && entry.by.kind === "session") ids.push(entry.by.sessionId);
		if ("note" in entry && "sessionId" in entry.note && entry.note.sessionId) ids.push(entry.note.sessionId);
	}
	return ids;
}

/** The session Board task `task`'s thread shows: `picked`, the one the address names, when the task names it; else the one a reply wakes, or on a done Board task the last one started on it. */
export const threadSession = (task: BoardTask, picked: string | null): string | null =>
	(picked !== null && namedIn(task).includes(picked) ? picked : null) ?? wakeTarget(task, { kind: "user" }) ?? (task.doneAt !== null ? (startedOn(task).at(-1) ?? null) : null);
