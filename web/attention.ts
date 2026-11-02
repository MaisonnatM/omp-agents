/** Which live sessions need you, and the alerts they raise, for the desktop app's Dock badge and the session notifications. */
import type { SessionAlert } from "../src/shared/desktop-bridge";
import { hashForSession, type RosterHost, type UnreadTurn, type UserRequest, type View } from "../src/shared/sessions";
import { hostLabel } from "./labels";

/**
 * What a session waits on you for now: its oldest open question, else a wait with no question relayed (a terminal
 * session's own dialog, or the placeholder a terminal session shows until its host replays the question), else its
 * unread turn; `null` while it does not need you.
 */
export type Wait = { kind: "ask"; request: UserRequest } | { kind: "input" } | { kind: "turn"; turn: UnreadTurn };

export function waitOf(host: RosterHost): Wait | null {
	const [request] = host.requests;
	if (request) return { kind: "ask", request };
	if (host.status === "needs-input") return { kind: "input" };
	if (host.unread) return { kind: "turn", turn: host.unread };
	return null;
}

/** What a wait with no question relayed says. */
export const WAITS_FOR_INPUT = "Waits for your input.";
/** What an unread turn that ended on no reply says. */
export const FINISHED_TURN = "Finished its turn.";

/** Whether live session `host` needs you: it asks you something, or it ended a turn you have not looked at since. */
export const needsYou = (host: RosterHost): boolean => waitOf(host) !== null;

/** A session's {@link Wait} as an alert tells it. A question and a turn carry a key that names them across roster pushes; the bare wait has none. */
type Moment = { kind: "ask" | "turn"; key: string; body: string } | { kind: "input"; body: string };

function momentOf(host: RosterHost): Moment | null {
	const wait = waitOf(host);
	if (!wait) return null;
	switch (wait.kind) {
		case "ask": {
			const { request } = wait;
			return { kind: "ask", key: `ask/${request.id}`, body: request.kind === "confirm" ? `${request.title}\n${request.message}` : request.title };
		}
		case "input":
			return { kind: "input", body: WAITS_FOR_INPUT };
		case "turn":
			return { kind: "turn", key: `turn/${wait.turn.at}`, body: wait.turn.reply ?? FINISHED_TURN };
		default: {
			const unhandled: never = wait;
			return unhandled;
		}
	}
}

/**
 * What the page knows of one live session. `wait` is the episode it is in: `null` while it does not need you, `"input"`
 * while the episode showed only a wait with no question, and `"told"` once it showed a question or a turn. `heard` holds
 * the keys of the questions and turns found or raised, which stay heard while the session lives.
 */
interface Watch {
	wait: "input" | "told" | null;
	heard: ReadonlySet<string>;
}

/** The live sessions this page has seen, by instance id. */
export type Attention = ReadonlyMap<string, Watch>;

/** Whether `moment` of a session the page has seen as `seen` raises an alert. */
function raises(seen: Watch, moment: Moment): boolean {
	switch (moment.kind) {
		case "input":
			return seen.wait === null;
		case "ask":
			// A question that details the bare wait already raised or found is the same episode.
			return seen.wait !== "input" && !seen.heard.has(moment.key);
		case "turn":
			return !seen.heard.has(moment.key);
		default: {
			const unhandled: never = moment;
			return unhandled;
		}
	}
}

/** One alert `attend` raises, and whether a finished turn raised it rather than a question or a wait. */
export interface Raised {
	alert: SessionAlert;
	turn: boolean;
}

/**
 * The alerts that `hosts`, the sessions on the roster now, raise after `before`, and what the page knows from now on.
 * A session the page sees for the first time raises nothing, so what already waited when the page loaded, or before a
 * terminal session joined, stays quiet; a session that came to need you since the page saw it not needing you raises.
 */
export function attend(before: Attention, hosts: readonly RosterHost[]): { raise: Raised[]; attention: Attention } {
	const raise: Raised[] = [];
	const attention = new Map<string, Watch>();
	for (const host of hosts) {
		const seen = before.get(host.instanceId);
		const moment = momentOf(host);
		const heard = seen?.heard ?? new Set<string>();
		if (!moment) {
			attention.set(host.instanceId, { wait: null, heard });
			continue;
		}
		if (seen && raises(seen, moment)) raise.push({ alert: { hash: hashForSession(host.sessionId), title: hostLabel(host), body: moment.body }, turn: moment.kind === "turn" });
		if (moment.kind === "input") attention.set(host.instanceId, { wait: seen?.wait ?? "input", heard });
		else attention.set(host.instanceId, { wait: "told", heard: heard.has(moment.key) ? heard : new Set([...heard, moment.key]) });
	}
	return { raise, attention };
}

/** The live sessions among `shown`, the views on screen, that ended a turn you had not seen: showing them in a focused window reads it. */
export function unreadShown(hosts: readonly RosterHost[], shown: readonly View[]): string[] {
	const ids = new Set(shown.flatMap(view => (view.kind === "live" && view.agentId === null ? [view.instanceId] : [])));
	return hosts.filter(host => host.unread !== null && ids.has(host.instanceId)).map(host => host.instanceId);
}
