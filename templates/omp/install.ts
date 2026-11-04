/**
 * Installs the omp starter kit: copies `agent/` into the omp agent directory and applies `config.yml` through
 * `omp config set`, so omp writes every setting and leaves the rest of your config alone. A setting you already have
 * keeps your value unless you pass `--force`. A file you already have is replaced only when you never edited it: it
 * matches what the last install wrote, as `starter-kit-installed.json` records, or a version the kit shipped before, as
 * the kit's git history holds; one you edited keeps your version unless you pass `--force`. `--maintainer` copies
 * `maintainer/` on top, and a file there replaces the `agent/` file with the same relative path; later installs
 * remember it. `--files` only brings the files up to date, never adds back one you deleted, and needs no omp; the
 * dashboard's Update runs it.
 *
 *   bun run omp-template [--dry-run] [--force] [--maintainer]
 *   bun run omp-template --files [--dry-run]
 */
import { createHash } from "node:crypto";
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

/** Where the installer records, in the agent directory, what it last wrote there. */
export const INSTALLED_RECORD = "starter-kit-installed.json";

/** Whether the last install copied `maintainer/`, and the git blob id of each file it wrote, by its path in the agent directory. */
export interface InstalledRecord {
	maintainer: boolean;
	files: Record<string, string>;
}

/** The id `git hash-object` gives `text`, so a recorded file and the kit's history compare alike. */
export function blobId(text: string): string {
	const bytes = Buffer.from(text);
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** The record the last install left in `agentDir`, or `null` before the first install that keeps one. */
export function readInstalledRecord(agentDir: string): InstalledRecord | null {
	const path = join(agentDir, INSTALLED_RECORD);
	if (!existsSync(path)) return null;
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isObject(parsed) || typeof parsed.maintainer !== "boolean" || !isObject(parsed.files)) throw new Error(`${path} is not a starter kit install record`);
	const files: Record<string, string> = {};
	for (const [rel, id] of Object.entries(parsed.files)) if (typeof id === "string") files[rel] = id;
	return { maintainer: parsed.maintainer, files };
}

/** Records the files an install wrote or found already matching, keeping the entries of the files it left alone. */
function writeInstalledRecord(agentDir: string, previous: InstalledRecord | null, maintainer: boolean, files: readonly (KitFile & { action: Action })[]): void {
	const recorded = { ...previous?.files };
	for (const file of files) if (file.action !== "keep") recorded[file.rel] = blobId(file.text);
	const record: InstalledRecord = { maintainer, files: recorded };
	writeFileSync(join(agentDir, INSTALLED_RECORD), `${JSON.stringify(record, null, "\t")}\n`);
}

const histories = new Map<string, Map<string, Set<string>>>();

/**
 * Every blob id each kit file has had in `kit`'s git history, by its path in the agent directory, read once per
 * process; empty when the kit is not in a git checkout, as in the packaged app.
 */
function kitHistory(kit: string): Map<string, Set<string>> {
	const known = histories.get(kit);
	if (known) return known;
	const history = new Map<string, Set<string>>();
	histories.set(kit, history);
	let listing = "";
	try {
		const args = ["log", "--format=", "--raw", "--no-abbrev", "--no-renames", "--diff-merges=first-parent", "--relative", "--", "agent", "maintainer"];
		const proc = Bun.spawnSync(["git", "-C", kit, ...args], { stdout: "pipe", stderr: "ignore" });
		if (proc.exitCode === 0) listing = proc.stdout.toString();
	} catch {
		return history;
	}
	for (const line of listing.split("\n")) {
		const [, before, after, rel] = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) \w+\t(?:agent|maintainer)\/(.+)$/.exec(line) ?? [];
		if (!before || !after || !rel) continue;
		const ids = history.get(rel) ?? new Set<string>();
		ids.add(before).add(after);
		history.set(rel, ids);
	}
	return history;
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

export type FileStep = KitFile & { dest: string; action: Action };

export interface KitFilesPlan {
	/** Whether `maintainer/` is copied: as asked, else as the last install did. */
	maintainer: boolean;
	files: FileStep[];
}

export interface StarterKitPlan extends KitFilesPlan {
	settings: SettingStep[];
	marketplace: { source: string; action: Action };
	plugins: { id: string; action: Action }[];
}

export interface StarterKitSnapshot {
	knownSettings: ReadonlySet<string>;
	hasMarketplace: boolean;
	plugins: ReadonlySet<string>;
}

export interface PlanOptions {
	force?: boolean;
	/** Copies `maintainer/` too; without it, as the last install did. */
	maintainer?: boolean;
}

/**
 * Read-only. A file you have is replaced when it differs and you never edited it: it matches what the last install
 * recorded, or a version in the kit's history.
 */
export function planKitFiles(kit: string, agentDir: string, { force = false, maintainer }: PlanOptions = {}): KitFilesPlan {
	if (!existsSync(join(kit, "agent"))) throw new Error(`Starter kit files are missing from ${kit}`);
	const record = readInstalledRecord(agentDir);
	const withMaintainer = maintainer ?? record?.maintainer ?? false;
	const layers = [layerFiles(join(kit, "agent"))];
	if (withMaintainer) layers.push(layerFiles(join(kit, "maintainer")));
	const untouched = (rel: string, current: string): boolean => {
		const id = blobId(current);
		return record?.files[rel] === id || kitHistory(kit).get(rel)?.has(id) === true;
	};
	const files = overlayFiles(layers).map(file => {
		const dest = join(agentDir, file.rel);
		const current = existsSync(dest) ? readFileSync(dest, "utf8") : undefined;
		const replace = force || (current !== undefined && current !== file.text && untouched(file.rel, current));
		return { ...file, dest, action: planValue(current, file.text, replace) };
	});
	return { maintainer: withMaintainer, files };
}

/** Read-only, including settings and plugins. Callers supply native or CLI reads, never config initialization here. */
export function planStarterKit(kit: string, agentDir: string, snapshot: StarterKitSnapshot, options: PlanOptions = {}): StarterKitPlan {
	const { maintainer, files } = planKitFiles(kit, agentDir, options);
	const userConfigPath = join(agentDir, "config.yml");
	const user = existsSync(userConfigPath) ? readYamlMapping(userConfigPath) : {};
	const settings = planSettings(settingsOf(readYamlMapping(join(kit, "config.yml")), snapshot.knownSettings), user, options.force ?? false);
	return {
		maintainer,
		files,
		settings,
		marketplace: { source: STARTER_KIT_MARKETPLACE.source, action: snapshot.hasMarketplace ? "same" : "create" },
		plugins: PLUGINS.map(id => ({ id, action: snapshot.plugins.has(id) ? "same" : "create" })),
	};
}

const writes = (action: Action): boolean => action === "create" || action === "update";

function writeFiles(files: readonly FileStep[]): void {
	for (const file of files.filter(f => writes(f.action))) {
		mkdirSync(dirname(file.dest), { recursive: true });
		writeFileSync(file.dest, file.text);
	}
}

/** `--files`: the kit's files only, as the last install chose them, never adding back one you deleted since. */
function updateFiles(kit: string, agentDir: string, dryRun: boolean): void {
	const record = readInstalledRecord(agentDir);
	if (!record) {
		console.log(`No starter kit install is recorded in ${agentDir}, so nothing changed; run bun run omp-template once.`);
		return;
	}
	console.log(`${dryRun ? "Would update" : "Updating"} the omp starter kit's files in ${agentDir}`);
	const plan = planKitFiles(kit, agentDir, { maintainer: record.maintainer });
	const files = plan.files.map(file => (file.action === "create" && file.rel in record.files ? { ...file, action: "keep" as const } : file));
	for (const file of files) if (file.action !== "same") print(file.action, `file ${file.rel}`);
	if (dryRun) {
		console.log("Dry run, nothing written.");
		return;
	}
	writeFiles(files);
	writeInstalledRecord(agentDir, record, plan.maintainer, files);
	console.log("Done.");
}

async function main(argv: string[]): Promise<void> {
	const knownFlags = ["--dry-run", "--force", "--maintainer", "--files"];
	const unknown = argv.find(arg => !knownFlags.includes(arg));
	if (unknown) throw new Error(`unknown option ${unknown}; use --dry-run, --force, --maintainer, or --files`);
	const dryRun = argv.includes("--dry-run");
	const force = argv.includes("--force");
	const kit = import.meta.dir;
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent");
	if (argv.includes("--files")) {
		if (force || argv.includes("--maintainer")) throw new Error("--files takes only --dry-run");
		updateFiles(kit, agentDir, dryRun);
		return;
	}
	const { command: ompCommand } = resolveOmp();

	const listed: unknown = JSON.parse(await omp(ompCommand, ["config", "list", "--json"]));
	if (!isObject(listed) || Array.isArray(listed)) throw new Error("omp config list returned no settings");
	const snapshot: StarterKitSnapshot = {
		knownSettings: new Set(Object.keys(listed)),
		hasMarketplace: new RegExp(`^\\s*${STARTER_KIT_MARKETPLACE.name}\\s`, "m").test(await omp(ompCommand, ["plugin", "marketplace", "list"])),
		plugins: pluginIds(JSON.parse(await omp(ompCommand, ["plugin", "list", "--json"]))),
	};
	const previous = readInstalledRecord(agentDir);
	const plan = planStarterKit(kit, agentDir, snapshot, { force, maintainer: argv.includes("--maintainer") || undefined });
	const { maintainer, files, settings, marketplace, plugins } = plan;
	const profile = maintainer ? " and the maintainer git profile" : "";
	console.log(`${dryRun ? "Would install" : "Installing"} the omp starter kit${profile} into ${agentDir}${force ? ", overwriting your versions" : ""}`);
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

	writeFiles(files);
	writeInstalledRecord(agentDir, previous, maintainer, files);
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
