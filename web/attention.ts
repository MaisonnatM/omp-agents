/** Which live sessions need you, and the alerts they raise, for the desktop app's Dock badge and the session notifications. */
import type { SessionAlert } from "../src/shared/desktop-bridge";
import type { Project } from "../src/shared/projects";
import type { RosterHost, View } from "../src/shared/sessions";
import { hostLabel } from "./labels";

/** The live sessions that answer to you: a project's workers answer to its coordinator, which hears when they finish or ask. */
export function yourSessions(hosts: readonly RosterHost[], projects: readonly Project[]): RosterHost[] {
	const workers = new Set(projects.flatMap(project => project.workers.map(worker => worker.sessionId)));
	return hosts.filter(host => !workers.has(host.sessionId));
}

/** Whether live session `host` needs you: it asks you something, or it ended a turn you have not looked at since. */
export const needsYou = (host: RosterHost): boolean => host.status === "needs-input" || host.unread !== null;

/** Each moment `hosts` wait on you now: every question open, and every turn unread. */
export function alertsOf(hosts: readonly RosterHost[]): SessionAlert[] {
	return hosts.flatMap(host => {
		const at = { sessionId: host.sessionId, title: hostLabel(host) };
		const alerts: SessionAlert[] = host.requests.map(request => ({
			...at,
			key: `${host.instanceId}/ask/${request.id}`,
			body: request.kind === "confirm" ? `${request.title}\n${request.message}` : request.title,
		}));
		// A terminal session can wait on a dialog of its own that Collab does not relay as a question.
		if (alerts.length === 0 && host.status === "needs-input") alerts.push({ ...at, key: `${host.instanceId}/input`, body: "Waits for your input." });
		if (host.unread) alerts.push({ ...at, key: `${host.instanceId}/turn/${host.unread.at}`, body: host.unread.reply ?? "Finished its turn." });
		return alerts;
	});
}

/**
 * The alerts of `now` not heard before, and the keys heard from now on. `heard` is `null` until the first roster, whose
 * alerts all count as heard, so a page that loads raises none for what already waited; a moment raises one alert however
 * many roster pushes repeat it.
 */
export function freshAlerts(heard: ReadonlySet<string> | null, now: readonly SessionAlert[]): { fresh: SessionAlert[]; heard: Set<string> } {
	return { fresh: heard === null ? [] : now.filter(alert => !heard.has(alert.key)), heard: new Set(now.map(alert => alert.key)) };
}

/** The live sessions among `shown`, the views on screen, that ended a turn you had not seen: showing them in a focused window reads it. */
export function unreadShown(hosts: readonly RosterHost[], shown: readonly View[]): string[] {
	const ids = new Set(shown.flatMap(view => (view.kind === "live" && view.agentId === null ? [view.instanceId] : [])));
	return hosts.filter(host => host.unread !== null && ids.has(host.instanceId)).map(host => host.instanceId);
}
