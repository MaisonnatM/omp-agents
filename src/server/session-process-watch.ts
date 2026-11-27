/** The dashboard's {@link SessionProcessWatch}, over the live sessions, the process settings, the computer's memory, and every port's keepers. */
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { endKept, listAllKeepers } from "../keeper-link";
import { readMemory } from "../memory-reading";
import { ompDaemons } from "../omp/daemons";
import { readSessionFile, sessionsDir } from "../omp/sessions";
import { privateSessionsDir } from "../paths";
import { readProcessTableWithFootprints } from "../process-census";
import type { PrivateDeleting } from "../shared/notices";
import { awaitsScheduled, awaitsSubagents, type RosterHost } from "../shared/sessions";
import type { LiveSessions } from "./live-sessions";
import { PrivateSessions } from "./private-sessions";
import type { ProcessSettingsFile } from "./process-settings-file";
import type { ResourceHistory } from "./resource-history";
import { readAppOf, readCwds, readListeningPorts, readOpenSessionFiles, readSessionFiles, SessionProcessWatch, stopProcesses } from "./session-processes";

/** The dashboard's parts the process watch reads. */
export interface SessionProcessWatchParts {
	sessions: LiveSessions;
	hosts(): RosterHost[];
	pathOf(sessionId: string): string | null;
	owner(): boolean;
	processSettings: ProcessSettingsFile;
	/** This port's private sessions, which a private stray's end deletes. */
	privateSessions: PrivateSessions;
	history: ResourceHistory;
	/** The port this server listens on. */
	port: number;
	/** The private sessions the idle session stop deletes within five minutes. */
	warn(warnings: PrivateDeleting[]): void;
}

export function sessionProcessWatch({ sessions, hosts, pathOf, owner, processSettings, privateSessions, history, port, warn }: SessionProcessWatchParts): SessionProcessWatch {
	return new SessionProcessWatch({
		...ompDaemons(),
		readTable: readProcessTableWithFootprints,
		readPorts: readListeningPorts,
		readCwds,
		readSessionFiles,
		readOpenSessionFiles: pids => readOpenSessionFiles(pids, sessionsDir),
		titleOf: async file => (await readSessionFile(file))?.title ?? null,
		appOf: readAppOf,
		stopProcesses,
		sessions: () =>
			hosts().map(row => ({
				instanceId: row.instanceId,
				// Named as the sidebar names a live session.
				title: row.sessionName ?? basename(row.cwd),
				sessionId: row.sessionId,
				file: sessions.transcriptPath(row.instanceId, null, pathOf),
				pid: row.pid,
				cwd: row.cwd,
				status: row.status,
				waitsOnWork: awaitsSubagents(row) || awaitsScheduled(row),
				stopsWhenIdle: row.source === "dashboard",
				private: row.source === "dashboard" && row.private,
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
		readMemory,
		readKeepers: () => listAllKeepers(),
		port,
		endStray: async keeper => {
			await endKept(keeper);
			if (!keeper.private) return;
			// Another port's private session lives in that port's directory; its server, gone, kept no pins of it here.
			const purger = keeper.port === port ? privateSessions : new PrivateSessions({ root: join(dirname(privateSessionsDir), String(keeper.port)), unpin: () => {} });
			await purger.purge(keeper.instanceId);
		},
		record: sample => void history.record(sample),
		warn,
	});
}
