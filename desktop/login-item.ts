/**
 * Open at Login on macOS, through a LaunchAgent that runs the shell's Electron on this checkout.
 * Electron's own login item cannot pass that path, and an app that launchd starts gets no shell environment, so the
 * agent carries the variables that the server and omp need to find `bun`, `omp`, and their files.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const BUNDLE_ID = "dev.omp-agents.desktop";

/** Copied from the environment the box was ticked in. The rest stays out, so no secret a shell exports lands in a plain file. */
const CARRIED_ENV = ["PATH", "XDG_CONFIG_HOME", "OMP_PACKAGE_DIR", "PI_CODING_AGENT_DIR"];

/** One agent per port, as each port is its own server and its own app instance. */
const label = (port: number): string => `${BUNDLE_ID}.port-${port}`;
const agentPath = (port: number): string => join(homedir(), "Library", "LaunchAgents", `${label(port)}.plist`);

export const opensAtLogin = (port: number): boolean => existsSync(agentPath(port));

/** Writes or removes the agent; launchd reads it at the next login, so nothing starts now. */
export function setOpenAtLogin(port: number, open: boolean, program: string[]): void {
	const path = agentPath(port);
	if (!open) {
		rmSync(path, { force: true });
		return;
	}
	const env = Object.fromEntries(CARRIED_ENV.flatMap(name => (process.env[name] ? [[name, process.env[name]]] : [])));
	const agent = {
		Label: label(port),
		ProgramArguments: program,
		EnvironmentVariables: { ...env, PORT: String(port) },
		RunAtLoad: true,
		ProcessType: "Interactive",
	};
	mkdirSync(dirname(path), { recursive: true });
	execFileSync("plutil", ["-convert", "xml1", "-o", path, "-"], { input: JSON.stringify(agent) });
}
