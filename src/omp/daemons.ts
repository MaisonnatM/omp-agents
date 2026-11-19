/** omp's per-user daemon: the services it runs, as `omp ps` lists them, the stop of one, and the start of a session's own. */
import type { SessionProcessWatchDeps } from "../server/session-processes";
import { config, daemonClient, psTable } from "./modules";
import type { ProcSpec } from "./module-types/processes";

/** How long the daemon gives a stopped service to exit before it kills it. */
const SERVICE_STOP_MS = 3_000;

/** How many lines of its output tell why a service ended as it started. */
const ENDED_LOG_LINES = 40;

/** How long a started service has to listen on its port; one that runs but does not listen yet still counts as started. */
const READY_MS = 30_000;

/** The parts of {@link SessionProcessWatchDeps} that omp decides; neither reading nor stopping starts a daemon. */
export function ompDaemons(): Pick<SessionProcessWatchDeps, "readServices" | "projectDir" | "stopService"> {
	return {
		readServices: async () => {
			const client = await daemonClient.probeDaemon();
			if (!client) return [];
			try {
				const { units } = await client.request({ op: "list", kind: "proc" });
				return units.filter(unit => unit.supervised && !psTable.TERMINAL_STATES[unit.state]);
			} finally {
				client.close();
			}
		},
		projectDir: cwd => daemonClient.canonicalProjectDir(cwd),
		stopService: async unit => {
			const client = await daemonClient.probeDaemon();
			if (!client) return;
			try {
				await client.request({ op: "stop", unit: unit.id, generation: unit.generation, timeoutMs: SERVICE_STOP_MS });
			} finally {
				client.close();
			}
		},
	};
}

/** A long-lived command to run as a service, as omp's bash tool starts one: `name`, ready once `readyPort` accepts a connection. */
export interface OwnedService {
	name: string;
	command: string;
	env: Record<string, string>;
	readyPort: number;
}

/**
 * Starts `service` in `dir` as a service session `owner` owns, in the shell omp's settings for `dir` give its bash tool,
 * in the scope of the project `dir` is in, on omp's daemon, which starts when none runs, replacing one of the same name.
 * Settles once it is ready, its readiness timed out, or it ended, and then holds the last lines of its output.
 */
export async function startOwnedService(dir: string, owner: string, service: OwnedService): Promise<{ running: true } | { ended: string }> {
	const shell = (await config.Settings.loadReadOnly({ cwd: dir })).getShellConfig();
	const proc: ProcSpec = {
		application: shell.shell,
		args: [...shell.args, `${shell.prefix ? `${shell.prefix} ` : ""}${service.command}`],
		env: { ...shell.env, ...service.env },
		cwd: dir,
		pty: true,
		ready: { port: service.readyPort, timeoutMs: READY_MS },
	};
	const client = await daemonClient.daemonClient();
	const { unit } = await client.request({
		op: "open",
		kind: "proc",
		scope: { kind: "project", dir: await daemonClient.canonicalProjectDir(dir) },
		key: service.name,
		label: service.name,
		proc,
		policy: { hold: "persist", restart: "no", survive: "exec" },
		owner,
		replace: true,
		awaitReady: true,
		lease: false,
	});
	if (!psTable.TERMINAL_STATES[unit.state]) return { running: true };
	const logs = await client.request({ op: "logs", unit: unit.id, lines: ENDED_LOG_LINES, head: false, follow: false, timeoutMs: 1_000 });
	const output = logs.terminalOutput ? logs.terminalOutput.trimEnd().split("\n").slice(-ENDED_LOG_LINES).join("\n") : logs.text;
	return { ended: Bun.stripANSI(output).trim() };
}
