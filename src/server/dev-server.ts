/**
 * **Start dev server**: the command a project's `package.json` runs its dev server with, on a port picked here, and its
 * start as a service of omp's project broker that the session owns. `docs/architecture/session-processes.md` says how.
 */
import { createServer } from "node:net";
import { join } from "node:path";
import type { startOwnedService } from "../omp/daemons";
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

/** The env files a dev server reads in development, whose local addresses name the other servers it talks to. */
const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"] as const;

/** A script that runs more than one server, whose ports one `PORT` cannot keep apart. */
const SEVERAL_SERVERS = /(?:^|&&|;|\|\|)\s*(?:(?:npx|bunx)\s+)?(?:concurrently|npm-run-all|run-p|turbo|nx|lerna)\b|[^&>]&(?![&>])/;

/** A port the script sets itself, which the one picked here cannot override, such as `--port 3000` or `PORT=3000`. */
const PINNED_PORT = /(?:--port[= ]|(?:^|\s)-p\s+|\bPORT=)(\d+)/;

/** An env line pointing at a server on this computer, such as `PUBLIC_API_URL=http://localhost:8000`. */
const LOCAL_SERVER_ENV = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*["']?(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+)/m;

/** The files at the project's root that decide its dev server's command. */
const ROOT_FILES = ["package.json", ...LOCKFILES.map(([file]) => file), ...ENV_FILES];

/**
 * The command, such as `bun run dev --port 23456`, that runs the dev server of the project whose root holds `files`,
 * by name, on `port`, else why it cannot be started without the session: no script, a script that runs several servers
 * or pins its port, or an env file that points the app at another local server, such as its API, which this start
 * would not run and which may be another checkout's. `PORT` is set either way; `--port` only for servers that take it.
 */
export function planDevServer(files: Readonly<Record<string, string>>, port: number): { command: string } | { reason: string } {
	const packageJson = files["package.json"];
	if (packageJson === undefined) return { reason: "no package.json" };
	let manifest: unknown;
	try {
		manifest = JSON.parse(packageJson);
	} catch {
		return { reason: "package.json is not valid JSON" };
	}
	const scripts = isObject(manifest) && isObject(manifest.scripts) ? manifest.scripts : {};
	for (const script of SCRIPTS) {
		const body = scripts[script];
		if (typeof body !== "string") continue;
		if (SEVERAL_SERVERS.test(body)) return { reason: `the ${script} script runs several servers` };
		const pinned = PINNED_PORT.exec(body)?.[1];
		if (pinned !== undefined) return { reason: `the ${script} script pins port ${pinned}` };
		for (const file of ENV_FILES) {
			const local = files[file] === undefined ? null : LOCAL_SERVER_ENV.exec(files[file]);
			if (local) return { reason: `${file} points ${local[1]} at ${local[2]}, a server this start would not run` };
		}
		const manager = LOCKFILES.find(([file]) => file in files)?.[1] ?? "npm";
		const last = body.split(/&&|;/).at(-1)?.trim().replace(COMMAND_PREFIX, "") ?? "";
		// npm passes a script arguments only after `--`.
		const portFlag = PORT_FLAG_COMMANDS.some(pattern => pattern.test(last)) ? `${manager === "npm" ? " --" : ""} --port ${port}` : "";
		return { command: `${manager} run ${script}${portFlag}` };
	}
	return { reason: "no dev or start script in package.json" };
}

/** The ports a dev server gets, above the ones dev servers default to and below macOS's ephemeral range. */
const PORTS = { from: 20_000, to: 39_999 };

/**
 * Starts the dev server of the project in `dir` as a service the omp session `sessionId` owns, through `start`, and
 * answers its port and command, else why it was left to the session: the plan's reason, or the broker's failure or the
 * output of a server that ended. A failure to read the project or find a port rejects, as the dashboard's own fault.
 */
export async function startDevServer(sessionId: string, dir: string, start: typeof startOwnedService): Promise<DevServerStart> {
	const [files, port] = await Promise.all([rootFiles(dir), freePort()]);
	const planned = planDevServer(files, port);
	if ("reason" in planned) return { fallback: planned.reason };
	const { command } = planned;
	try {
		const outcome = await start(dir, sessionId, { name: `dev-${port}`, command, env: { PORT: String(port) }, readyPort: port });
		return "ended" in outcome ? { fallback: `${command} exited: ${outcome.ended}` } : { started: { port, command } };
	} catch (err) {
		return { fallback: errorText(err) };
	}
}

/** The {@link ROOT_FILES} in `dir`, by name, with their text. */
async function rootFiles(dir: string): Promise<Record<string, string>> {
	const present = await Promise.all(
		ROOT_FILES.map(async file => {
			const handle = Bun.file(join(dir, file));
			return (await handle.exists()) ? [[file, await handle.text()] as const] : [];
		}),
	);
	return Object.fromEntries(present.flat());
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
