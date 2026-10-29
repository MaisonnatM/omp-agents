/**
 * Installs the omp starter kit: copies `agent/` into the omp agent directory and applies `config.yml` through
 * `omp config set`, so omp writes every setting and leaves the rest of your config alone. A file or a setting you
 * already have keeps your version unless you pass `--force`. `--maintainer` copies `maintainer/` on top, and a
 * file there replaces the `agent/` file with the same relative path.
 *
 *   bun run omp-template [--dry-run] [--force] [--maintainer]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { deepEquals, Glob } from "bun";
import { errorText, isObject } from "../../src/json";
import { resolveOmp } from "../../src/omp/resolve";

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

export interface KitFile {
	rel: string;
	text: string;
}

/** Later layers replace the same relative path. The result is sorted by `rel`. */
export function overlayFiles(layers: readonly (readonly KitFile[])[]): KitFile[] {
	const byRel: Record<string, string> = {};
	for (const layer of layers) for (const file of layer) byRel[file.rel] = file.text;
	return Object.entries(byRel).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, text]) => ({ rel, text }));
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
	if (!isObject(listing) || !Array.isArray(listing.marketplace)) throw new Error("omp plugin list returned no marketplace plugins");
	return new Set(listing.marketplace.map(plugin => {
		if (!isObject(plugin) || typeof plugin.id !== "string") throw new Error("omp plugin list returned a plugin without an id");
		return plugin.id;
	}));
}

export const STARTER_KIT_MARKETPLACE = { name: "cursor-plugins", source: "cursor/plugins" };
/** pstack provides the `Poteto Mode` skill that `poteto-mode` points at, and the `poteto-agent` that `/ship` delegates to. */
const PLUGINS = ["pstack@cursor-plugins"];

const LABEL: Record<Action, string> = { create: "add", update: "overwrite", keep: "keep yours", same: "unchanged" };

async function omp(command: readonly string[], args: string[]): Promise<string> {
	const proc = Bun.spawn([...command, ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) throw new Error(`omp ${args.join(" ")} failed: ${(err || out).trim()}`);
	return out;
}

function print(action: Action, what: string): void {
	console.log(`  ${LABEL[action].padEnd(10)} ${what}`);
}

function layerFiles(root: string): KitFile[] {
	if (!existsSync(root)) return [];
	return [...new Glob("**/*").scanSync({ cwd: root, dot: true })].sort().map(rel => ({ rel, text: readFileSync(join(root, rel), "utf8") }));
}

export interface StarterKitPlan {
	files: (KitFile & { dest: string; action: Action })[];
	settings: SettingStep[];
	marketplace: { source: string; action: Action };
	plugins: { id: string; action: Action }[];
}

export interface StarterKitSnapshot {
	knownSettings: ReadonlySet<string>;
	hasMarketplace: boolean;
	plugins: ReadonlySet<string>;
}

/** Read-only, including settings and plugins. Callers supply native or CLI reads, never config initialization here. */
export function planStarterKit(kit: string, agentDir: string, snapshot: StarterKitSnapshot, { force = false, maintainer = false } = {}): StarterKitPlan {
	if (!existsSync(join(kit, "agent"))) throw new Error(`Starter kit files are missing from ${kit}`);
	const layers = [layerFiles(join(kit, "agent"))];
	if (maintainer) layers.push(layerFiles(join(kit, "maintainer")));
	const files = overlayFiles(layers).map(file => {
		const dest = join(agentDir, file.rel);
		return { ...file, dest, action: planValue(existsSync(dest) ? readFileSync(dest, "utf8") : undefined, file.text, force) };
	});
	const userConfigPath = join(agentDir, "config.yml");
	const user = existsSync(userConfigPath) ? readYamlMapping(userConfigPath) : {};
	const settings = planSettings(settingsOf(readYamlMapping(join(kit, "config.yml")), snapshot.knownSettings), user, force);
	return {
		files,
		settings,
		marketplace: { source: STARTER_KIT_MARKETPLACE.source, action: snapshot.hasMarketplace ? "same" : "create" },
		plugins: PLUGINS.map(id => ({ id, action: snapshot.plugins.has(id) ? "same" : "create" })),
	};
}

async function main(argv: string[]): Promise<void> {
	const knownFlags = ["--dry-run", "--force", "--maintainer"];
	const unknown = argv.find(arg => !knownFlags.includes(arg));
	if (unknown) throw new Error(`unknown option ${unknown}; use --dry-run, --force, or --maintainer`);
	const dryRun = argv.includes("--dry-run");
	const force = argv.includes("--force");
	const maintainer = argv.includes("--maintainer");
	const { command: ompCommand } = resolveOmp();

	const kit = import.meta.dir;
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent");
	const profile = maintainer ? " and the maintainer git profile" : "";
	console.log(`${dryRun ? "Would install" : "Installing"} the omp starter kit${profile} into ${agentDir}${force ? ", overwriting your versions" : ""}`);

	const listed: unknown = JSON.parse(await omp(ompCommand, ["config", "list", "--json"]));
	if (!isObject(listed) || Array.isArray(listed)) throw new Error("omp config list returned no settings");
	const snapshot: StarterKitSnapshot = {
		knownSettings: new Set(Object.keys(listed)),
		hasMarketplace: new RegExp(`^\\s*${STARTER_KIT_MARKETPLACE.name}\\s`, "m").test(await omp(ompCommand, ["plugin", "marketplace", "list"])),
		plugins: pluginIds(JSON.parse(await omp(ompCommand, ["plugin", "list", "--json"]))),
	};
	const { files, settings, marketplace, plugins } = planStarterKit(kit, agentDir, snapshot, { force, maintainer });
	for (const file of files) print(file.action, `file ${file.rel}`);
	for (const setting of settings) print(setting.action, `setting ${setting.target}`);
	print(marketplace.action, `marketplace ${marketplace.source}`);
	for (const plugin of plugins) print(plugin.action, `plugin ${plugin.id}`);

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
		await omp(ompCommand, ["config", "set", target, typeof value === "object" ? JSON.stringify(value) : String(value)]);
	}
	if (writes(marketplace.action)) await omp(ompCommand, ["plugin", "marketplace", "add", marketplace.source]);
	for (const { id, action } of plugins) if (writes(action)) await omp(ompCommand, ["plugin", "install", id]);
	console.log(`Done.${keptNote}`);
}

if (import.meta.main) {
	main(Bun.argv.slice(2)).catch((err: unknown) => {
		console.error(`omp-template: ${errorText(err)}`);
		process.exit(1);
	});
}
