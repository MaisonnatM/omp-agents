/** omp's daemon brokers: the services each project's broker runs, as `omp ps` lists them, the stop of one, and the start of a session's own. */
import type { SessionProcessWatchDeps } from "../server/session-processes";
import { type DaemonSpec, launchClient, launchPaths, psData, psTable } from "./modules";

/** How long the broker gives a stopped service to exit before it kills it. */
const SERVICE_STOP_MS = 3_000;

/** How many lines of its output tell why a service ended as it started. */
const ENDED_LOG_LINES = 40;

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

/**
 * Starts `spec` as a service session `owner` owns, in the broker of the project `dir` is in, which starts when none
 * runs, replacing one of the same name. Settles once it is ready, its readiness timed out, or it ended, and then holds
 * the last lines of its output.
 */
export async function startOwnedService(dir: string, owner: string, spec: DaemonSpec): Promise<{ running: true } | { ended: string }> {
	const client = await launchClient.createDaemonBrokerClient(dir);
	try {
		const { daemon } = await client.request({ op: "start", spec, owner, replace: true, awaitReady: true });
		if (!psTable.TERMINAL_STATES[daemon.state]) return { running: true };
		const logs = await client.request({ op: "logs", name: spec.name, lines: ENDED_LOG_LINES, head: false, follow: false, renderTerminalRows: true, timeoutMs: 1_000 });
		return { ended: Bun.stripANSI(logs.terminalRows?.join("\n") ?? logs.text).trim() };
	} finally {
		client.close();
	}
}
