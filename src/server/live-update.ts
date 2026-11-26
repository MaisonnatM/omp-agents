/**
 * Where every live session's update goes: the views, the broadcasts, the Bots, and the loops. The dashboard builds the
 * handler once its parts exist and hands it to {@link LiveSessions} through its live-update callback.
 */
import { errorText } from "../json";
import { routineTurn } from "../live-session";
import type { AutoContinue } from "./auto-continue";
import type { Bots } from "./bots";
import type { Broadcasts } from "./broadcasts";
import type { InterruptedSessions } from "./interrupted";
import type { LiveSessions, SessionUpdate } from "./live-sessions";
import type { Loops } from "./loops";
import type { PrivateSessions } from "./private-sessions";
import type { ReviewDrafts } from "./review-drafts";
import type { RoutinesFile } from "./routines-file";
import type { SessionMoves } from "./session-moves";
import type { SessionWaits } from "./session-waits";
import type { Views } from "./views";

/** Coalesce a burst of background job output into one push of the jobs list. */
const JOBS_PUSH_MS = 250;

/** The dashboard's parts a live session's update reaches. */
export interface LiveUpdateDeps {
	sessions: LiveSessions;
	views: Views;
	moves: SessionMoves;
	waits: SessionWaits;
	broadcasts: Broadcasts;
	reviewDrafts: ReviewDrafts;
	bots: Bots;
	privateSessions: PrivateSessions;
	interrupted: InterruptedSessions;
	loops: Loops;
	autoContinue: AutoContinue;
	routines: RoutinesFile;
	pathOf(sessionId: string): string | null;
}

/** Where every live session's update goes: the views, the broadcasts, the Bots, and the loops. */
export function liveUpdateHandler(deps: LiveUpdateDeps): (instanceId: string, update: SessionUpdate) => void {
	const { sessions, views, moves, waits, broadcasts, reviewDrafts, bots, privateSessions, interrupted, loops, autoContinue, routines } = deps;
	// biome-ignore lint/correctness/noUnusedVariables: read by the ??= below, which Biome counts only as a write
	let jobsPush: NodeJS.Timeout | undefined;
	const pushJobs = (): void => {
		jobsPush = undefined;
		broadcasts.pushList("jobs");
	};

	/** Records what the Bot's turn spent on each prompt run sent into conversation `sessionId` whose usage is not recorded yet, once that turn ended. */
	const recordRunUsage = (sessionId: string): void => {
		const path = deps.pathOf(sessionId);
		if (path === null) return;
		let changed = false;
		for (const routine of routines.value) {
			for (const run of routine.runs) {
				if (run.usage || run.outcome.kind !== "sent" || run.outcome.sessionId !== sessionId) continue;
				const turn = routineTurn(path, routine.id, run.at);
				if (!turn) continue;
				routines.usage(routine.id, run.at, turn.usage);
				changed = true;
			}
		}
		if (changed) broadcasts.pushList("routines");
	};

	return (instanceId, update) => {
		switch (update.kind) {
			case "roster":
				broadcasts.rosterChanged();
				return;
			case "event":
				views.applyEvent(instanceId, update.event);
				moves.heard(update.event);
				if (sessions.heard(instanceId, update.event)) broadcasts.rosterChanged();
				if (sessions.heardJob(instanceId, update.event)) jobsPush ??= setTimeout(pushJobs, JOBS_PUSH_MS);
				return;
			case "starting":
				views.starting(instanceId);
				return;
			case "note":
				views.note(instanceId, update.agentId, update.level, update.text);
				return;
			case "exited": {
				// Only a session this dashboard started reports its exit.
				const sessionId = sessions.get(instanceId)?.sessionId;
				const isPrivate = sessions.started(instanceId)?.private === true;
				reviewDrafts.exited(instanceId);
				moves.exited(instanceId);
				// Its last turn may have remembered something.
				if (bots.changed(instanceId)) broadcasts.pushList("bots");
				bots.exited(instanceId);
				sessions.remove(instanceId);
				waits.exited(instanceId);
				// A private session lives exactly as long as its omp, so it is deleted rather than interrupted; the next server's sweep finishes a purge cut short.
				if (isPrivate) void privateSessions.purge(instanceId).catch((err: unknown) => console.error(`omp-agents: deleting private session ${instanceId} failed: ${errorText(err)}`));
				else if (sessionId && !update.ended) interrupted.interrupt(sessionId);
				broadcasts.syncRoster();
				void loops.listNow().catch((err: unknown) => console.error(`omp-agents: listing the session files failed: ${errorText(err)}`));
				return;
			}
			case "written":
				loops.fileChanged(update.path);
				return;
			case "switched": {
				// Before the edited prompt's events, so they land in the new file's transcript.
				views.sync();
				broadcasts.syncRoster();
				const sessionId = sessions.get(instanceId)?.sessionId;
				if (sessionId) {
					reviewDrafts.switched(instanceId, sessionId);
					bots.switched(instanceId, sessionId);
				}
				return;
			}
			case "turn-started": {
				if (sessions.turnStarted(instanceId)) broadcasts.rosterChanged();
				// Whoever prompted, the session works again; its own continue, already claimed, stays.
				const sessionId = sessions.get(instanceId)?.sessionId;
				if (sessionId) autoContinue.turnStarted(sessionId);
				// Its row moves up with the prompt that started the turn.
				if (bots.changed(instanceId)) broadcasts.pushList("bots");
				return;
			}
			case "turn-ended": {
				// A quiet turn, such as a Bot's routine run that found nothing, leaves the session as unread as before it.
				sessions.turnEnded(instanceId, update.quiet ? null : { at: Date.now(), reply: update.reply });
				// A session started here that a usage limit or a transient fault stopped is held for its continue.
				const sessionId = sessions.started(instanceId)?.sessionId;
				if (sessionId) autoContinue.turnEnded(sessionId, update.failure);
				broadcasts.rosterChanged();
				if (bots.changed(instanceId)) broadcasts.pushList("bots");
				const turnSessionId = sessions.get(instanceId)?.sessionId;
				if (turnSessionId) recordRunUsage(turnSessionId);
				return;
			}
			default: {
				const unhandled: never = update;
				return unhandled;
			}
		}
	};
}
