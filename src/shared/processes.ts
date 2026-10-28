/** What each live session runs besides omp, as the status bar's CPU card lists it, and the idle stop's setting. */
import { isObject, type Parsed } from "../json";

/** Something a live session runs besides omp itself. */
export interface SessionProcess {
	/** Opaque, stable while it runs; the stop request names it. */
	id: string;
	/** `job`: a process group under the session's omp. `service`: a daemon omp's project broker runs for it. */
	kind: "job" | "service";
	/** A broker daemon no session owns, such as omp's shared browser, which every live session of the project uses. */
	shared: boolean;
	/** What to show: a job's top process's command line, a service's daemon name plus command. */
	label: string;
	/** The summed resident memory of the job's process group, or of the daemon and what it started. */
	memoryBytes: number;
	/** The summed `ps` CPU percent of the same processes, each a percent of one core. */
	cpuPercent: number;
	processCount: number;
	/** The TCP ports its processes listen on, sorted, such as a dev server's. */
	ports: number[];
	/** In ms since the epoch. */
	startedAt: number;
	/** When the idle stop ends it; null while a session it serves is busy, the idle stop is off, or this server does not run unattended work. */
	stopsAt: number | null;
}

export interface SessionProcesses {
	/** omp and the helpers in its own process group, its MCP servers. Not stoppable here. */
	omp: { memoryBytes: number; cpuPercent: number; processCount: number };
	/** Biggest memory first. */
	processes: SessionProcess[];
}

/** One live session's processes, as `GET /api/session-processes` lists every live session's. */
export interface LiveSessionProcesses extends SessionProcesses {
	instanceId: string;
}

/** The body of `PUT /api/session-processes/stop`. */
export interface ProcessStop {
	instanceId: string;
	id: string;
}

export interface ProcessSettings {
	/** null: never stop idle processes. */
	stopIdleAfterMinutes: number | null;
}

/** The idle stops the page offers, in minutes; `null` is off. */
export const STOP_IDLE_CHOICES = [null, 15, 30, 60, 120] as const;

export const DEFAULT_PROCESS_SETTINGS: ProcessSettings = { stopIdleAfterMinutes: 30 };

/** Settings that name one of {@link STOP_IDLE_CHOICES}, as `processes.json` and `PUT /api/process-settings` hold them. */
export function parseProcessSettings(value: unknown): Parsed<ProcessSettings> {
	if (!isObject(value)) return null;
	const minutes = STOP_IDLE_CHOICES.find(choice => choice === value.stopIdleAfterMinutes);
	return minutes === undefined ? null : { ok: { stopIdleAfterMinutes: minutes } };
}
