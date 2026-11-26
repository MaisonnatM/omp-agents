// The checks the board tool's `done` runs before a session hands its branch back: the checks `.omp/land.json` lists
// before its first group, quick ones such as the CHANGELOG and test-edit checks, on the branch's committed HEAD with
// `LAND_BASE` set to its merge base with the target. A failure then reaches the session that wrote the branch instead
// of the landing after it ended. The group, the full suite, runs only at land.
import { spawn, spawnSync } from "node:child_process";
import { CONFIG_FILE, type LandConfig, readConfig, tail } from "../land/lander";

/** How long one check may run before `done` stops it. */
const CHECK_MS = 2 * 60_000;

/** The checks of `config` before its first group; none when it has no group, since then its checks are the suite. */
export function leadingChecks(config: LandConfig): string[] {
	const group = config.checks.findIndex(entry => Array.isArray(entry));
	return group < 0 ? [] : config.checks.slice(0, group).filter(entry => typeof entry === "string");
}

function gitOut(cwd: string, args: string[]): string | null {
	const done = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	return done.status === 0 ? done.stdout.trim() : null;
}

function sh(command: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<{ code: number | null; out: string }> {
	const { promise, resolve } = Promise.withResolvers<{ code: number | null; out: string }>();
	const child = spawn("sh", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"], timeout: CHECK_MS, ...(signal ? { signal } : {}) });
	let out = "";
	const take = (chunk: Buffer) => {
		out = (out + chunk.toString()).slice(-16_000);
	};
	child.stdout.on("data", take);
	child.stderr.on("data", take);
	child.on("error", error => {
		out += String(error);
	});
	child.on("close", code => resolve({ code, out }));
	return promise;
}

/**
 * Why `done` refuses the checkout at `cwd`: a leading check that fails on its committed HEAD, with the check's output,
 * or a `.omp/land.json` that does not read. `null` outside git, without that file, without leading checks, or when
 * HEAD has no commit the target lacks.
 */
export async function doneRefusal(cwd: string, signal?: AbortSignal): Promise<string | null> {
	const top = gitOut(cwd, ["rev-parse", "--show-toplevel"]);
	if (top === null) return null;
	let config: LandConfig | null;
	try {
		config = readConfig(top);
	} catch (error) {
		return `Not done: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (!config) return null;
	const checks = leadingChecks(config);
	if (checks.length === 0) return null;
	const target = [`refs/remotes/${config.remote}/${config.target}`, `refs/heads/${config.target}`].find(ref => gitOut(top, ["rev-parse", "-q", "--verify", ref]) !== null);
	if (!target) return null;
	const tip = gitOut(top, ["rev-parse", "HEAD"]);
	const base = gitOut(top, ["merge-base", "HEAD", target]);
	if (tip === null || base === null || base === tip) return null;
	const env = { ...process.env, LAND_BASE: base, LAND_TIP: tip };
	for (const command of checks) {
		const run = await sh(command, top, env, signal);
		if (run.code === 0) continue;
		return [
			`Not done: \`${command}\` from ${CONFIG_FILE} failed on commit ${tip.slice(0, 12)}, against its merge base ${base.slice(0, 12)} with ${target.replace(/^refs\/(remotes|heads)\//, "")}. Landing runs it too: fix the cause, commit, and mark the Board task done again.`,
			`Output:\n${tail(run.out) || "(none)"}`,
		].join("\n\n");
	}
	return null;
}
