/**
 * Gives a packaged app the environment of the user's login shell. An app that Finder, the Dock, or Open at Login starts
 * gets launchd's bare environment, with no `bun`, `omp`, `gh`, or `git` on its PATH and none of the variables that
 * move omp's or this app's files. Imported first by `main.ts`, so `src/paths.ts` reads the shell's `XDG_CONFIG_HOME`.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { errorText } from "../src/json";

/** Variables that describe the probe's own shell, not the user's environment. */
const SHELL_LOCAL: Record<string, true> = { PWD: true, OLDPWD: true, SHLVL: true, _: true };
const TIMEOUT_MS = 10_000;

/** The login shell's variables, read through `env -0` between two markers that set them apart from what its rc files print. */
function loginShellEnv(): Record<string, string> {
	const shell = process.env.SHELL || "/bin/zsh";
	const mark = `omp-agents-env-${randomUUID()}`;
	// `-i` too: Bun's installer adds `~/.bun/bin` to the PATH in `.zshrc`, which a login shell alone does not read.
	const out = execFileSync(shell, ["-ilc", `printf '%s' '${mark}'; command env -0; printf '%s' '${mark}'`], {
		encoding: "utf8",
		timeout: TIMEOUT_MS,
		stdio: ["ignore", "pipe", "ignore"],
	});
	const body = out.split(mark)[1];
	if (body === undefined) throw new Error(`${shell} printed no environment`);
	const env: Record<string, string> = {};
	for (const entry of body.split("\0")) {
		const eq = entry.indexOf("=");
		if (eq > 0 && !SHELL_LOCAL[entry.slice(0, eq)]) env[entry.slice(0, eq)] = entry.slice(eq + 1);
	}
	return env;
}

if (app.isPackaged) {
	try {
		Object.assign(process.env, loginShellEnv());
	} catch (err) {
		console.error(`omp-agents: cannot read the login shell's environment: ${errorText(err)}`);
	}
}
