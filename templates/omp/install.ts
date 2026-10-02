/**
 * Installs the omp starter kit: copies `agent/` into the omp agent directory and applies `config.yml` through
 * `omp config set`, so omp writes every setting and leaves the rest of your config alone. A file or a setting you
 * already have keeps your version unless you pass `--force`.
 *
 *   bun run omp-template [--dry-run] [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { deepEquals, Glob } from "bun";
import { isObject } from "../../src/json";

type Json = Record<string, unknown>;

/** `keep`: yours differs and stays. `same`: yours already matches. */
export type Action = "create" | "update" | "keep" | "same";

export interface SettingStep {
	target: string;
	value: unknown;
	action: Action;
}

/**
 * The template's settings as `[key, value]` pairs, each key one that `omp config set` takes. A mapping that is not
 * itself a setting is walked, so `task: { isolation: { merge } }` becomes `task.isolation.merge`.
 */
export function settingsOf(template: Json, known: ReadonlySet<string>, prefix = ""): [string, unknown][] {
	return Object.entries(template).flatMap(([name, value]): [string, unknown][] => {
		const key = prefix + name;
		if (known.has(key)) return [[key, value]];
		if (isObject(value) && !Array.isArray(value)) return settingsOf(value, known, `${key}.`);
		throw new Error(`omp has no setting ${key}`);
	});
}

function valueAt(config: Json, key: string): unknown {
	let node: unknown = config;
	for (const part of key.split(".")) node = isObject(node) ? node[part] : undefined;
	return node;
}

/** Decides each setting against the user's own `config.yml`, not omp's defaults, so only values you chose count as yours. */
export function planSettings(settings: [string, unknown][], user: Json, force: boolean): SettingStep[] {
	return settings.map(([target, value]) => ({ target, value, action: planValue(valueAt(user, target), value, force) }));
}

/** `current` is `undefined` when you have no such file or setting. */
export function planValue(current: unknown, value: unknown, force: boolean): Action {
	if (current === undefined) return "create";
	if (deepEquals(current, value)) return "same";
	return force ? "update" : "keep";
}

/** A YAML file's top-level mapping; an empty file reads as none. */
function readYamlMapping(path: string): Json {
	const parsed: unknown = Bun.YAML.parse(readFileSync(path, "utf8"));
	if (parsed === null || parsed === undefined) return {};
	if (!isObject(parsed) || Array.isArray(parsed)) throw new Error(`${path} does not hold a mapping`);
	return parsed;
}

/** The ids of installed marketplace plugins, from `omp plugin list --json`. */
function pluginIds(listing: unknown): Set<string> {
	const plugins = isObject(listing) && Array.isArray(listing.marketplace) ? listing.marketplace : [];
	return new Set(plugins.flatMap(plugin => (isObject(plugin) && typeof plugin.id === "string" ? [plugin.id] : [])));
}

const MARKETPLACE = { name: "cursor-plugins", source: "cursor/plugins" };
/** pstack provides the `Poteto Mode` skill that `poteto-mode` points at, and the `poteto-agent` that `/ship` delegates to. */
const PLUGINS = ["pstack@cursor-plugins"];

const LABEL: Record<Action, string> = { create: "add", update: "overwrite", keep: "keep yours", same: "unchanged" };

async function omp(args: string[]): Promise<string> {
	const proc = Bun.spawn(["omp", ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) throw new Error(`omp ${args.join(" ")} failed: ${(err || out).trim()}`);
	return out;
}

function print(action: Action, what: string): void {
	console.log(`  ${LABEL[action].padEnd(10)} ${what}`);
}

async function main(argv: string[]): Promise<void> {
	const unknown = argv.find(arg => arg !== "--dry-run" && arg !== "--force");
	if (unknown) throw new Error(`unknown option ${unknown}; use --dry-run or --force`);
	const dryRun = argv.includes("--dry-run");
	const force = argv.includes("--force");
	if (!Bun.which("omp")) throw new Error("`omp` is not on PATH; install it with `bun install -g @oh-my-pi/pi-coding-agent`");

	const kit = import.meta.dir;
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent");
	console.log(`${dryRun ? "Would install" : "Installing"} the omp starter kit into ${agentDir}${force ? ", overwriting your versions" : ""}`);

	const files = [...new Glob("**/*").scanSync({ cwd: join(kit, "agent"), dot: true })].sort().map(rel => {
		const dest = join(agentDir, rel);
		const text = readFileSync(join(kit, "agent", rel), "utf8");
		return { rel, dest, text, action: planValue(existsSync(dest) ? readFileSync(dest, "utf8") : undefined, text, force) };
	});
	for (const file of files) print(file.action, `file ${file.rel}`);

	const listed: unknown = JSON.parse(await omp(["config", "list", "--json"]));
	const known = new Set(isObject(listed) ? Object.keys(listed) : []);
	const userConfigPath = join(agentDir, "config.yml");
	const user = existsSync(userConfigPath) ? readYamlMapping(userConfigPath) : {};
	const settings = planSettings(settingsOf(readYamlMapping(join(kit, "config.yml")), known), user, force);
	for (const setting of settings) print(setting.action, `setting ${setting.target}`);

	const hasMarketplace = new RegExp(`^\\s*${MARKETPLACE.name}\\s`, "m").test(await omp(["plugin", "marketplace", "list"]));
	const installed = pluginIds(JSON.parse(await omp(["plugin", "list", "--json"])));
	print(hasMarketplace ? "same" : "create", `marketplace ${MARKETPLACE.source}`);
	for (const id of PLUGINS) print(installed.has(id) ? "same" : "create", `plugin ${id}`);

	const kept = [...files, ...settings].filter(step => step.action === "keep").length;
	const keptNote = kept > 0 ? ` ${kept} of yours ${dryRun ? "would stay" : "stayed"}; pass --force to overwrite them.` : "";
	if (dryRun) {
		console.log(`Dry run, nothing written.${keptNote}`);
		return;
	}

	const writes = (action: Action): boolean => action === "create" || action === "update";
	for (const file of files.filter(f => writes(f.action))) {
		mkdirSync(dirname(file.dest), { recursive: true });
		writeFileSync(file.dest, file.text);
	}
	for (const { target, value } of settings.filter(s => writes(s.action))) {
		await omp(["config", "set", target, typeof value === "object" ? JSON.stringify(value) : String(value)]);
	}
	if (!hasMarketplace) await omp(["plugin", "marketplace", "add", MARKETPLACE.source]);
	for (const id of PLUGINS.filter(id => !installed.has(id))) await omp(["plugin", "install", id]);
	console.log(`Done.${keptNote}`);
}

if (import.meta.main) {
	main(Bun.argv.slice(2)).catch((err: unknown) => {
		console.error(`omp-template: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	});
}
