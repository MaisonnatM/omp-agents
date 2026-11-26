/** What the Board page and its sidebar read from a Board task beyond its fold: how its work stands, which session its thread shows, and the ready count. */
import { type RosterHost, type Stop, stopOf } from "../../../src/shared/sessions";
import { type BoardState, type BoardTask, startedOn, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";

/** Where a Board task in work stands: its session starting, its last start failed with `error`, its session working, or its session stopped for you, as `stopOf` says. */
export type Work = { kind: "starting" } | { kind: "failed"; error: string } | { kind: "working"; sessionId: string } | { kind: "waiting"; sessionId: string; stop: Stop };

/** Board task `task`'s {@link Work}, `null` once it is done or waits on another Board task. */
export function workOf(state: BoardState, task: BoardTask, hosts: readonly RosterHost[]): Work | null {
	const status = statusOf(state, task);
	if (status.kind === "failed") return { kind: "failed", error: status.error };
	if (status.kind !== "ready" && status.kind !== "claimed") return null;
	const sessionId = task.claim?.sessionId ?? task.start?.sessionId ?? null;
	if (sessionId === null) return { kind: "starting" };
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

/** How many of Workspace `workspace`'s Board tasks are ready, the count beside it in the sidebar; one whose start failed waits on your reply, so it is not. */
export const readyIn = (state: BoardState, workspace: string): number => state.tasks.filter(task => task.workspace === workspace && statusOf(state, task).kind === "ready").length;
