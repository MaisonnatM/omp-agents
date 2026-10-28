/**
 * **Start dev server**: the command a project's `package.json` runs its dev server with, on a port picked here.
 * `docs/architecture/session-processes.md` says how the Browser starts it.
 */
import { isObject } from "../json";

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/** The lockfile that names each package manager, checked in order; a project with none runs npm. */
export const LOCKFILES: readonly (readonly [file: string, manager: PackageManager])[] = [
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
