import { type DevServerStart, type LiveSessionProcesses, parseProcessSettings, type ProcessSettings, type ProcessStop } from "../shared/processes";
import type { ResourceSample, ResourcesView } from "../shared/resources";
import { HISTORY_DAYS } from "./resource-history";
import { parseDevServerRequest, parseProcessStop } from "./wire";
import { answer, checked } from "./http";
import type { RouteKit, Routes } from "./route-kit";

/** What the live sessions run besides omp, the start of a session's dev server, when the idle stop ends them, and who holds memory. */
export interface ProcessRoutesEnv {
	/** Every live session's processes, in roster order. */
	list(): Promise<LiveSessionProcesses[]>;
	/** Stops the session's process `id`, unless either no longer runs, and answers what every live session runs after. */
	stop(stop: ProcessStop): Promise<LiveSessionProcesses[]>;
	/** This Mac's memory, who holds it, what stops next, and the automatic stops so far. */
	resources(): Promise<ResourcesView>;
	/** The Resources page's samples of the last `hours`, oldest first. */
	history(hours: number): Promise<ResourceSample[]>;
	/** Starts live session `instanceId`'s dev server as a service it owns, else answers why it could not; rejects when the session no longer runs. */
	startServer(instanceId: string): Promise<DevServerStart>;
	settings(): ProcessSettings;
	changeSettings(settings: ProcessSettings): ProcessSettings;
}

/** `?hours=`, 1 to the 14 days the history keeps, else 24. */
function hoursOf(param: string | null): number {
	const hours = Number(param ?? 24);
	return Number.isFinite(hours) && hours >= 1 ? Math.min(hours, HISTORY_DAYS * 24) : 24;
}

/** The live sessions' processes, the stop of one, the start of a session's dev server, the idle stops' settings, and the Resources page's reads. */
export function processRoutes({ get, write }: RouteKit, env: ProcessRoutesEnv): Routes {
	return {
		"/api/session-processes": { GET: get(() => answer(() => env.list())) },
		"/api/resources": { GET: get(() => answer(() => env.resources())) },
		"/api/resources/history": { GET: get(params => answer(() => env.history(hoursOf(params.get("hours"))))) },
		"/api/session-processes/stop": {
			PUT: write(
				(body) => checked(parseProcessStop(body), "Expected { instanceId, id } naming a live session and one of its processes"),
				(stop) => env.stop(stop),
			),
		},
		"/api/session-processes/start-server": {
			PUT: write(
				(body) => checked(parseDevServerRequest(body), "Expected { instanceId } naming a live session"),
				({ instanceId }) => env.startServer(instanceId),
			),
		},
		"/api/process-settings": {
			GET: get(() => answer(async () => env.settings())),
			PUT: write(
				(body) => checked(parseProcessSettings(body), "Expected { stopIdleAfterMinutes, stopIdleSessionsAfterHours }: minutes of null, 15, 30, 60, or 120, and hours of null, 4, 12, 24, or 72"),
				async (settings) => env.changeSettings(settings),
			),
		},
	};
}
