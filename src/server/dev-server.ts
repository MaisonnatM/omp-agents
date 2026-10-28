/**
 * **Start dev server**: the command a project's `package.json` runs its dev server with, on a port picked here, and its
 * start as a service of omp's project broker that the session owns. `docs/architecture/session-processes.md` says how.
 */
import { createServer } from "node:net";
import { join } from "node:path";
import type { DaemonSpec } from "../omp/modules";
import type { DevServerStart } from "../shared/processes";
import { errorText, isObject } from "../json";

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/** The lockfile that names each package manager, checked in order; a project with none runs npm. */
const LOCKFILES: readonly (readonly [file: string, manager: PackageManager])[] = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
];

/** What goes between `<manager> run <script>` and the script's own arguments: npm takes them only after `--`. */
const ARGS_SEPARATOR: Record<PackageManager, string> = { bun: "", pnpm: "", yarn: "", npm: " --" };

/** The scripts that run a dev server, preferred first. */
const SCRIPTS = ["dev", "start"] as const;

/**
 * The dev servers that take `--port N`, matched against the last command of the script without its environment
 * assignments or `npx`; any other script gets only `PORT`. A build, such as `vite build`, does not match.
 */
const PORT_FLAG_COMMANDS: readonly RegExp[] = [
	/^vite(?:\s+(?:dev|serve))?(?=\s+-|$)/,
	/^astro\s+dev(?=\s+-|$)/,
	/^(?:nuxt|nuxi)\s+dev(?=\s+-|$)/,
	/^next\s+dev(?=\s+-|$)/,
	/^svelte-kit\s+dev(?=\s+-|$)/,
	/^(?:webpack\s+serve|webpack-dev-server)(?=\s+-|$)/,
	/^remix\s+vite:dev(?=\s+-|$)/,
];

/** What leads a command without being it: `cross-env` or `env`, `NAME=value` assignments, and `npx` or `bunx`. */
const COMMAND_PREFIX = /^(?:(?:cross-env|env)\s+)?(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:npx|bunx)\s+)?/;

export interface DevServerPlan {
	script: (typeof SCRIPTS)[number];
	/** What a login shell runs in the project, such as `bun run dev --port 23456`. */
	command: string;
	env: { PORT: string };
	port: number;
	/** The command passes `--port`, since the script's server takes it; `PORT` is set either way. */
	portFlag: boolean;
}

/**
 * How the project whose `package.json` holds `packageJson`, `null` when it has none, and whose directory holds the
 * files `lockfiles` runs its dev server on `port`, else why it cannot be started without the session.
 */
export function planDevServer(packageJson: string | null, lockfiles: readonly string[], port: number): { ok: DevServerPlan } | { reason: string } {
	if (packageJson === null) return { reason: "no package.json" };
	let manifest: unknown;
	try {
		manifest = JSON.parse(packageJson);
	} catch {
		return { reason: "package.json is not valid JSON" };
	}
	const scripts = isObject(manifest) && isObject(manifest.scripts) ? manifest.scripts : {};
	const script = SCRIPTS.find(name => typeof scripts[name] === "string");
	if (script === undefined) return { reason: "no dev or start script in package.json" };
	const manager = LOCKFILES.find(([file]) => lockfiles.includes(file))?.[1] ?? "npm";
	const last = (scripts[script] as string).split(/&&|;/).at(-1)?.trim().replace(COMMAND_PREFIX, "") ?? "";
	const portFlag = PORT_FLAG_COMMANDS.some(pattern => pattern.test(last));
	const command = `${manager} run ${script}${portFlag ? `${ARGS_SEPARATOR[manager]} --port ${port}` : ""}`;
	return { ok: { script, command, env: { PORT: String(port) }, port, portFlag } };
}

/** The ports a dev server gets, above the ones dev servers default to and below macOS's ephemeral range. */
const PORTS = { from: 20_000, to: 39_999 };

/** How long a started dev server has to listen on its port; one that runs but does not listen yet still counts as started. */
const READY_MS = 30_000;

/** Starts `spec` as a service session `owner` owns in `dir`'s project; `startOwnedService` in `src/omp/daemons.ts`. */
export type StartOwnedService = (dir: string, owner: string, spec: DaemonSpec) => Promise<{ running: true } | { ended: string }>;

/**
 * Starts the dev server of the project in `dir` as a service the omp session `sessionId` owns, through `start`, and
 * answers its port and command, else why it could not, from the plan, the broker, or the output of a server that ended.
 */
export async function startDevServer(sessionId: string, dir: string, start: StartOwnedService): Promise<DevServerStart> {
	try {
		const [packageJson, lockfiles, port] = await Promise.all([readPackageJson(dir), lockfilesIn(dir), freePort()]);
		const planned = planDevServer(packageJson, lockfiles, port);
		if (!("ok" in planned)) return { fallback: planned.reason };
		const { command, env } = planned.ok;
		const outcome = await start(dir, sessionId, {
			name: `dev-${port}`,
			application: process.env.SHELL ?? "/bin/sh",
			args: ["-lc", command],
			env,
			cwd: dir,
			pty: true,
			ready: { port, timeoutMs: READY_MS },
			restart: "no",
			persist: false,
			detached: false,
		});
		return "ended" in outcome ? { fallback: `${command} exited: ${outcome.ended}` } : { started: { port, command } };
	} catch (err) {
		return { fallback: errorText(err) };
	}
}

async function readPackageJson(dir: string): Promise<string | null> {
	const file = Bun.file(join(dir, "package.json"));
	return (await file.exists()) ? file.text() : null;
}

async function lockfilesIn(dir: string): Promise<string[]> {
	const present = await Promise.all(LOCKFILES.map(async ([file]) => ((await Bun.file(join(dir, file)).exists()) ? [file] : [])));
	return present.flat();
}

/** A random port in {@link PORTS} that nothing listens on now on 127.0.0.1, where the broker checks readiness. */
async function freePort(): Promise<number> {
	for (let tries = 0; tries < 20; tries++) {
		const port = PORTS.from + Math.floor(Math.random() * (PORTS.to - PORTS.from + 1));
		if (await bindable(port)) return port;
	}
	throw new Error(`no free port from ${PORTS.from} to ${PORTS.to}`);
}

function bindable(port: number): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const server = createServer();
	server.once("error", () => resolve(false));
	server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	return promise;
}
