/** Which live sessions need you, and the alerts they raise, for the desktop app's Dock badge and the session notifications. */
import type { SessionAlert } from "../src/shared/desktop-bridge";
import type { Project } from "../src/shared/projects";
import { hashForSession, type RosterHost, type View } from "../src/shared/sessions";
import { hostLabel } from "./labels";

/** The live sessions that answer to you: a project's workers answer to its coordinator, which hears when they finish or ask. */
export function yourSessions(hosts: readonly RosterHost[], projects: readonly Project[]): RosterHost[] {
	const workers = new Set(projects.flatMap(project => project.workers.map(worker => worker.sessionId)));
	return hosts.filter(host => !workers.has(host.sessionId));
}

/** Whether live session `host` needs you: it asks you something, or it ended a turn you have not looked at since. */
export const needsYou = (host: RosterHost): boolean => host.status === "needs-input" || host.unread !== null;

/** What each of `hosts` waits on you for now, one alert per session: its oldest open question, else its unread turn. */
export function alertsOf(hosts: readonly RosterHost[]): SessionAlert[] {
	return hosts.flatMap(host => {
		const at = { hash: hashForSession(host.sessionId), title: hostLabel(host) };
		const [request] = host.requests;
		if (request) {
			const body = request.kind === "confirm" ? `${request.title}\n${request.message}` : request.title;
			return [{ ...at, key: `${host.instanceId}/ask/${request.id}`, body }];
		}
		// A terminal session can wait on a dialog of its own that Collab does not relay as a question.
		if (host.status === "needs-input") return [{ ...at, key: `${host.instanceId}/input`, body: "Waits for your input." }];
		if (host.unread) return [{ ...at, key: `${host.instanceId}/turn/${host.unread.at}`, body: host.unread.reply ?? "Finished its turn." }];
		return [];
	});
}

/**
 * The alerts of `now` never heard, and the keys heard from now on. `heard` is `null` until the first roster, whose
 * alerts all count as heard, so a page that loads raises none for what already waited. A key stays heard once it is,
 * so a question that a reconnect replays, or a wait that flaps, raises no second alert.
 */
export function freshAlerts(heard: ReadonlySet<string> | null, now: readonly SessionAlert[]): { fresh: SessionAlert[]; heard: Set<string> } {
	const keys = new Set(heard);
	const fresh = now.filter(alert => !keys.has(alert.key));
	for (const alert of now) keys.add(alert.key);
	return { fresh: heard === null ? [] : fresh, heard: keys };
}

/** The live sessions among `shown`, the views on screen, that ended a turn you had not seen: showing them in a focused window reads it. */
export function unreadShown(hosts: readonly RosterHost[], shown: readonly View[]): string[] {
	const ids = new Set(shown.flatMap(view => (view.kind === "live" && view.agentId === null ? [view.instanceId] : [])));
	return hosts.filter(host => host.unread !== null && ids.has(host.instanceId)).map(host => host.instanceId);
}
