/** omp's daemon brokers: the services each project's broker runs, as `omp ps` lists them, and the stop of one. */
import type { SessionProcessWatchDeps } from "../server/session-processes";
import { launchPaths, psData, psTable } from "./modules";

/** How long the broker gives a stopped service to exit before it kills it. */
const SERVICE_STOP_MS = 3_000;

/** The parts of {@link SessionProcessWatchDeps} that omp decides. */
export function ompDaemons(): Pick<SessionProcessWatchDeps, "readDaemons" | "projectDir" | "stopService"> {
	return {
		readDaemons: async () =>
			(await psData.collectReports(true, {})).map(report => ({
				scope: report.scope,
				daemons: report.daemons.filter(daemon => daemon.supervised && !psTable.TERMINAL_STATES[daemon.snapshot.state]),
			})),
		projectDir: cwd => launchPaths.canonicalProjectDir(cwd),
		stopService: async (scope, name, id) => {
			const client = await psData.scopeClient(scope);
			try {
				await client.request({ op: "stop", name, id, timeoutMs: SERVICE_STOP_MS });
			} finally {
				client.close();
			}
		},
	};
}
