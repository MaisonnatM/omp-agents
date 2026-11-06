import { type DevServerStart, type LiveSessionProcesses, parseProcessSettings, type ProcessSettings, type ProcessStop } from "../shared/processes";
import { parseDevServerRequest, parseProcessStop } from "./wire";
import { answer, checked } from "./http";
import type { RouteKit, Routes } from "./route-kit";

/** What the live sessions run besides omp, the start of a session's dev server, and when the idle stop ends them. */
export interface ProcessRoutesEnv {
	/** Every live session's processes, in roster order. */
	list(): Promise<LiveSessionProcesses[]>;
	/** Stops the session's process `id`, unless either no longer runs, and answers what every live session runs after. */
	stop(stop: ProcessStop): Promise<LiveSessionProcesses[]>;
	/** Starts live session `instanceId`'s dev server as a service it owns, else answers why it could not; rejects when the session no longer runs. */
	startServer(instanceId: string): Promise<DevServerStart>;
	settings(): ProcessSettings;
	changeSettings(settings: ProcessSettings): ProcessSettings;
}

/** The live sessions' processes, the stop of one, the start of a session's dev server, and the idle stop's setting. */
export function processRoutes({ get, write }: RouteKit, env: ProcessRoutesEnv): Routes {
	return {
		"/api/session-processes": { GET: get(() => answer(() => env.list())) },
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
				(body) => checked(parseProcessSettings(body), "Expected { stopIdleAfterMinutes } of null, 15, 30, 60, or 120"),
				async (settings) => env.changeSettings(settings),
			),
		},
	};
}
