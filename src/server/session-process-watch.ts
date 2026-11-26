/** The dashboard's {@link SessionProcessWatch}, over the live sessions and the process settings. */
import { statSync } from "node:fs";
import { ompDaemons } from "../omp/daemons";
import { readProcessTable } from "../process-census";
import { awaitsScheduled, awaitsSubagents, type RosterHost } from "../shared/sessions";
import type { LiveSessions } from "./live-sessions";
import type { ProcessSettingsFile } from "./process-settings-file";
import { readAppOf, readCwds, readListeningPorts, readSessionFiles, SessionProcessWatch, stopProcesses } from "./session-processes";

/** The dashboard's parts the process watch reads. */
export interface SessionProcessWatchParts {
	sessions: LiveSessions;
	hosts(): RosterHost[];
	pathOf(sessionId: string): string | null;
	owner(): boolean;
	processSettings: ProcessSettingsFile;
}

export function sessionProcessWatch({ sessions, hosts, pathOf, owner, processSettings }: SessionProcessWatchParts): SessionProcessWatch {
	return new SessionProcessWatch({
		...ompDaemons(),
		readTable: readProcessTable,
		readPorts: readListeningPorts,
		readCwds,
		readSessionFiles,
		appOf: readAppOf,
		stopProcesses,
		sessions: () =>
			hosts().map(row => ({
				instanceId: row.instanceId,
				sessionId: row.sessionId,
				file: sessions.transcriptPath(row.instanceId, null, pathOf),
				pid: row.pid,
				cwd: row.cwd,
				status: row.status,
				waitsOnWork: awaitsSubagents(row) || awaitsScheduled(row),
				stopsWhenIdle: row.source === "dashboard" && !row.private,
			})),
		endSession: async instanceId => {
			await sessions.started(instanceId)?.end();
		},
		lastWrittenAt: instanceId => {
			const path = sessions.get(instanceId)?.transcriptPath(null, pathOf);
			return path ? (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null) : null;
		},
		now: Date.now,
		owner,
		settings: () => {
			processSettings.reload();
			return processSettings.value;
		},
	});
}
