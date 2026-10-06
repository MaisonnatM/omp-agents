import type { PastSession, RosterHost, UserTodo } from "../src/shared";

type LiveWork = Pick<RosterHost, "sessionId" | "status" | "requests" | "pullRequests" | "ship">;
type PastWork = Pick<PastSession, "sessionId" | "pullRequests" | "ship">;

export type TodoWorkState =
	| { kind: "idea" }
	| { kind: "working"; sessionId: string }
	| { kind: "needs-you"; sessionId: string }
	| { kind: "in-review"; sessionId: string }
	| { kind: "shipped"; sessionId: string }
	| { kind: "ended"; sessionId: string }
	| { kind: "unavailable"; sessionId: string };

/** The most recently linked session owns the current work state; checking a todo remains a separate decision. */
export function workStateOf(todo: UserTodo, sessions: { hosts: readonly LiveWork[]; past: readonly PastWork[] }): TodoWorkState {
	const link = todo.links.findLast(link => link.kind === "session");
	if (!link || link.kind !== "session") return { kind: "idea" };
	const sessionId = link.sessionId;
	const host = sessions.hosts.find(host => host.sessionId === sessionId);
	if (host) {
		if (host.requests.length > 0 || host.status === "needs-input") return { kind: "needs-you", sessionId };
		if (host.status === "working") return { kind: "working", sessionId };
		if (host.ship?.stage === "merged") return { kind: "shipped", sessionId };
		if (host.pullRequests.some(pr => pr.link === "submitted")) return { kind: "in-review", sessionId };
		return host.status === "idle" ? { kind: "needs-you", sessionId } : { kind: "unavailable", sessionId };
	}
	const past = sessions.past.find(session => session.sessionId === sessionId);
	if (!past) return { kind: "unavailable", sessionId };
	if (past.ship?.stage === "merged") return { kind: "shipped", sessionId };
	if (past.pullRequests.some(pr => pr.link === "submitted")) return { kind: "in-review", sessionId };
	return { kind: "ended", sessionId };
}
