/**
 * Loads the collab, session-listing, and RPC modules shipped inside the installed
 * omp package so this app speaks the exact protocol, crypto, registry, session-file,
 * and RPC code of the omp version that is running the sessions.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CatalogModel, OmpFileKind, RetrySettings, RoutingEdit } from "./shared";
import { isObject, oneLine } from "./transcript";

export type Access = "view" | "control";

/** Subset of omp's `CollabHostSnapshot` (src/collab/registry.ts) this app reads. */
export interface HostSnapshot {
	instanceId: string;
	generation: number;
	pid: number;
	sessionId: string;
	sessionName: string | null;
	cwd: string;
	model: { provider: string; id: string } | null;
	startedAt: number;
	participants: number;
	relayConnected: boolean;
	inputRequired: boolean;
	busy: boolean | null;
	access: Access;
}

export type LinkErrorCode = "not_found" | "ambiguous" | "stale_generation" | "access_unavailable" | "unreachable";

/** Frame as decrypted by omp's relay client; parsed further by the transcript reducer. */
export type Frame = { t: string } & Record<string, unknown>;

/** Subset of omp's `CollabSocket` (src/collab/relay-client.ts). */
export interface CollabSocket {
	onOpen?: () => void;
	onFrame?: (frame: Frame, fromPeer: number) => void;
	onClose?: (reason: string, willReconnect: boolean) => void;
	connect(): void;
	send(frame: object): void;
	close(): void;
}

interface ParsedLink {
	wsUrl: string;
	key: Uint8Array;
	writeToken?: Uint8Array;
}

interface RegistryModule {
	listCollabHosts(): Promise<HostSnapshot[]>;
	resolveCollabHostLink(selector: string, access: Access): Promise<{ generation: number; access: Access; url: string }>;
	CollabLinkError: new (...args: never[]) => Error & { code: LinkErrorCode };
}
interface ProtocolModule {
	COLLAB_PROTO: number;
	parseCollabLink(link: string): ParsedLink | { error: string };
}
interface CryptoModule {
	importRoomKey(raw: Uint8Array): Promise<CryptoKey>;
}
interface RelayModule {
	CollabSocket: new (opts: { wsUrl: string; role: "guest"; key: CryptoKey }) => CollabSocket;
}

/** Subset of omp's `SessionInfo` (src/session/session-listing.ts) this app reads. */
interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	title?: string;
	modified: Date;
	firstMessage: string;
}
interface ListingModule {
	listAllSessions(): Promise<SessionInfo[]>;
	isEmptySession(session: SessionInfo): boolean;
}
interface DirsModule {
	getSessionsDir(): string;
	getAgentDir(): string;
}
/** Subset of omp's `SessionEntry` (src/session/session-entries.ts); the header has `type: "session"`. */
interface FileEntry {
	type: string;
	id: string;
	parentId?: string | null;
}
interface LoaderModule {
	loadEntriesFromFile(filePath: string): Promise<FileEntry[]>;
}
interface ExitDiagnosticsModule {
	createInterruptedTurnAbortMessage(
		entries: readonly FileEntry[],
		fallbackModel?: { api: string; provider: string; model: string },
	): object | undefined;
}

/** Subset of omp's `RpcSessionState` (src/modes/rpc/rpc-types.ts) this app reads. */
export interface RpcState {
	sessionId: string;
	/** Where the session will write; the file appears with its first message. */
	sessionFile?: string;
	sessionName?: string;
	model?: { provider: string; id: string };
	/** omp's `ThinkingLevel`. */
	thinkingLevel?: string;
	/** omp's `ContextUsage`: estimated tokens in the context window. */
	contextUsage?: { tokens: number; contextWindow: number };
}
/** Subset of omp's `RpcSubagentSnapshot` this app reads. */
export interface RpcSubagent {
	id: string;
	agent: string;
	/** omp's `AgentProgress["status"]`. */
	status: string;
	description?: string;
	sessionFile?: string;
}
/** Subset of omp's `RpcClient` (src/modes/rpc/rpc-client.ts). */
export interface RpcClient {
	start(): Promise<void>;
	stop(): Promise<void>;
	getState(): Promise<RpcState>;
	prompt(message: string, images?: undefined, streamingBehavior?: "steer" | "followUp"): Promise<string>;
	abort(): Promise<void>;
	/** omp's `ModelInfo` carries more fields; this app reads the selector parts. */
	getAvailableModels(): Promise<{ provider: string; id: string }[]>;
	setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
	/** Levels the live model accepts, `off` first. */
	getAvailableThinkingLevels(): Promise<string[]>;
	setThinkingLevel(level: string): Promise<void>;
	setSubagentSubscription(level: "progress"): Promise<string>;
	getSubagents(): Promise<RpcSubagent[]>;
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
	/** Moves to a new session file holding the history before the user prompt `entryId`; `text` is that prompt. */
	branch(entryId: string): Promise<{ text: string; cancelled: boolean }>;
	newSession(parentSession?: string): Promise<{ cancelled: boolean }>;
	onSessionEvent(listener: (event: Frame) => void): () => void;
	/** Payloads are the `task:subagent:lifecycle` / `task:subagent:progress` bus payloads. */
	onSubagentLifecycle(listener: (payload: unknown) => void): () => void;
	onSubagentProgress(listener: (payload: unknown) => void): () => void;
}
/** omp's `ptree.ChildProcess`: what `RpcClient` drives; this app reads its pid and waits for it to exit. */
interface RpcProcess {
	readonly pid: number;
	readonly exited: Promise<number>;
}
interface RpcClientModule {
	RpcClient: new (options: { spawn: (agentArgs: string[]) => RpcProcess }) => RpcClient;
}
interface UtilsModule {
	ptree: { spawn(cmd: string[], options: { cwd: string; stdin: "pipe" }): RpcProcess };
}

/** A session file on disk, newest first in {@link listSessionFiles}. */
export interface SavedSession {
	id: string;
	path: string;
	cwd: string;
	/** The session's title, else its first prompt as one line. */
	title: string | null;
	modifiedAt: number;
	/** A 0-turn stub, which omp's own picker hides. */
	empty: boolean;
}

/** Subset of pi-tui's `AutocompleteItem` (pi-tui/src/autocomplete.ts). */
export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}
/** pi-tui's `CombinedAutocompleteProvider`: omp's own `/` and `@` completion. */
export interface AutocompleteProvider {
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null>;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
}
interface AutocompleteModule {
	CombinedAutocompleteProvider: new (
		commands: { name: string; description?: string }[],
		basePath: string,
	) => AutocompleteProvider;
}

/** Subset of omp's `Skill` (src/extensibility/skills.ts). */
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
}
interface SkillsModule {
	loadSkills(options: Record<string, unknown> & { cwd: string }): Promise<{ skills: Skill[] }>;
	parseSkillInvocation(text: string): { name: string; args: string; prompt: string } | undefined;
	buildSkillPromptMessage(skill: Skill, input: { args: string; prompt?: string }): Promise<{ message: string }>;
}

/** Subset of omp's `FileSlashCommand` (src/extensibility/slash-commands.ts). */
export interface FileSlashCommand {
	name: string;
	description: string;
}
interface SlashCommandsModule {
	loadSlashCommands(options: { cwd: string }): Promise<FileSlashCommand[]>;
	expandSlashCommand(text: string, fileCommands: FileSlashCommand[]): string;
}

/** omp settings descriptors (`register`/`combine` in src/config); `get` reads one from a loaded Settings. */
interface SettingsReader<T> {
	get(settings: unknown): T;
}
/** Subset of omp's `Settings` (src/config/settings.ts) this app reads and writes. */
interface OmpSettingsInstance {
	/** `modelRoles` as configured, in config order. */
	getModelRoles(): Record<string, string>;
	/** Stages one role in the global `config.yml`; `flush` writes it, leaving every other role as it is on disk. */
	setModelRole(role: string, selector: string | undefined): void;
	/** Writes staged changes into the re-read global `config.yml` under omp's lock. */
	flush(): Promise<void>;
}
interface ConfigModule {
	Settings: {
		loadReadOnly(options: { cwd: string }): Promise<OmpSettingsInstance>;
		/** A private instance that persists what is set on it, unlike omp's process-wide `Settings.init`. */
		loadIsolated(options: { cwd: string }): Promise<OmpSettingsInstance>;
	};
}
/** Subset of omp's `Setting` handle (src/config/registry.ts). `set`/`setEntry` stage a global write; `undefined` removes. */
interface SettingHandle {
	readonly enumValues: readonly string[] | undefined;
	/** @throws Error when `value` does not fit the setting. */
	assertWritable(value: unknown): void;
	set(settings: OmpSettingsInstance, value: unknown): void;
	setEntry(settings: OmpSettingsInstance, key: string, value: unknown): void;
}
interface SettingsRegistryModule {
	lookup(id: string): SettingHandle | undefined;
}
interface ExtensionSettingsModule {
	cfgSkills: SettingsReader<Record<string, unknown> & { enableSkillCommands?: boolean }>;
	cfgDisabledExtensions: SettingsReader<string[]>;
}
interface SessionSettingsModule {
	cfgRetry: SettingsReader<Omit<RetrySettings, "fallbackRevertPolicy">>;
	cfgRetryFallbackChains: SettingsReader<Record<string, string[]>>;
	cfgRetryFallbackRevertPolicy: SettingsReader<string>;
}
interface ModelSettingsModule {
	cfgModelProviderOrder: SettingsReader<string[]>;
}
interface FallbackChainsModule {
	/** Gives every chat role without a chain of its own the `default` chain. */
	expandDefaultRetryFallbackChains(configured: Record<string, string[]>, roleNames: readonly string[]): Record<string, string[]>;
	/** omp's reading of a selector: `provider/id`, then an optional `:level` once `find` knows the id without it. */
	parseRetryFallbackSelector(
		selector: string,
		lookup: { find(provider: string, id: string): unknown },
	): { provider: string; id: string; thinkingLevel: string | undefined } | undefined;
}

/** Subset of omp's capability items (src/capability/types.ts): every item names the file it came from. */
interface CapabilityItem {
	_source: { provider: string; path: string; level: "user" | "project" | "native" };
}
interface DiscoveryModule {
	loadCapability(id: string, options: { cwd: string; disabledExtensions?: string[] }): Promise<{ items: CapabilityItem[] }>;
}
interface AgentDiscoveryModule {
	discoverAgents(cwd: string): Promise<{ agents: { source: string; filePath?: string }[] }>;
}
interface ConfigFilesModule {
	findConfigFile(subpath: string, options: { user?: boolean; project?: boolean; cwd?: string }): string | undefined;
}

const PACKAGE_NAME = "@oh-my-pi/pi-coding-agent";

function findPackageDir(): string {
	const override = process.env.OMP_PACKAGE_DIR;
	if (override) return override;
	const bin = Bun.which("omp");
	if (!bin) throw new Error("`omp` is not on PATH; set OMP_PACKAGE_DIR to the installed @oh-my-pi/pi-coding-agent directory");
	let dir = dirname(realpathSync(bin));
	while (dir !== dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (existsSync(manifest) && require(manifest).name === PACKAGE_NAME) return dir;
		dir = dirname(dir);
	}
	throw new Error(`could not find ${PACKAGE_NAME} above ${bin}; set OMP_PACKAGE_DIR`);
}

const packageDir = findPackageDir();
const collabDir = join(packageDir, "src", "collab");
if (!existsSync(join(collabDir, "relay-client.ts"))) {
	throw new Error(`${collabDir} does not ship the collab sources this app imports (omp too old or a compiled build)`);
}

const manifest = require(join(packageDir, "package.json")) as { version: string; bin: { omp: string } };
export const ompVersion: string = manifest.version;
/** Runs this same package's CLI, so new sessions match the modules loaded here. */
export const ompCommand: string[] = [process.execPath, join(packageDir, manifest.bin.omp)];

// Dynamic imports: the module location is the user's omp install, only known at runtime.
const registry = (await import(join(collabDir, "registry.ts"))) as RegistryModule;
const protocol = (await import(join(collabDir, "protocol.ts"))) as ProtocolModule;
const crypto = (await import(join(collabDir, "crypto.ts"))) as CryptoModule;
const relay = (await import(join(collabDir, "relay-client.ts"))) as RelayModule;
const listing = (await import(join(packageDir, "src", "session", "session-listing.ts"))) as ListingModule;
const srcDir = join(packageDir, "src");
const autocomplete = (await import(join(dirname(packageDir), "pi-tui", "src", "autocomplete.ts"))) as AutocompleteModule;
const skills = (await import(join(srcDir, "extensibility", "skills.ts"))) as SkillsModule;
const slashCommands = (await import(join(srcDir, "extensibility", "slash-commands.ts"))) as SlashCommandsModule;
const config = (await import(join(srcDir, "config", "settings.ts"))) as ConfigModule;
const extensionSettings = (await import(join(srcDir, "extensibility", "settings.ts"))) as ExtensionSettingsModule;

export const CombinedAutocompleteProvider = autocomplete.CombinedAutocompleteProvider;
export const { parseSkillInvocation, buildSkillPromptMessage } = skills;
export const { loadSlashCommands, expandSlashCommand } = slashCommands;

export interface SkillSettings {
	/** `skills.enableSkillCommands`: whether `/skill:<name>` is a command at all. */
	enableSkillCommands: boolean;
	skills: Skill[];
}

/** Skills the way an omp session in `cwd` discovers them: its settings, its disabled extensions, its project dirs. */
export async function loadSessionSkills(cwd: string): Promise<SkillSettings> {
	const settings = await config.Settings.loadReadOnly({ cwd });
	const skillSettings = extensionSettings.cfgSkills.get(settings);
	const disabledExtensions = extensionSettings.cfgDisabledExtensions.get(settings);
	const { skills: found } = await skills.loadSkills({ ...skillSettings, disabledExtensions, cwd });
	return { enableSkillCommands: skillSettings.enableSkillCommands === true, skills: found };
}

const sessionSettings = (await import(join(srcDir, "session", "settings.ts"))) as SessionSettingsModule;
const modelSettings = (await import(join(srcDir, "config", "model-settings.ts"))) as ModelSettingsModule;
const fallbackChains = (await import(join(srcDir, "session", "retry-fallback-chains.ts"))) as FallbackChainsModule;
const discovery = (await import(join(srcDir, "discovery", "index.ts"))) as DiscoveryModule;
const agentDiscovery = (await import(join(srcDir, "task", "discovery.ts"))) as AgentDiscoveryModule;
const configFiles = (await import(join(srcDir, "config.ts"))) as ConfigFilesModule;
const settingsRegistry = (await import(join(srcDir, "config", "registry.ts"))) as SettingsRegistryModule;

export const { expandDefaultRetryFallbackChains, parseRetryFallbackSelector } = fallbackChains;

/** omp's config as a session in `cwd` loads it: the global `config.yml`, the project's, and omp's defaults. */
export interface OmpConfig {
	modelRoles: Record<string, string>;
	/** `retry.fallbackChains` as configured, before omp applies the `default` chain to other roles. */
	fallbackChains: Record<string, string[]>;
	retry: RetrySettings;
	modelProviderOrder: string[];
	disabledExtensions: string[];
}

/** Read-only: omp's `loadReadOnly` never writes the config files back. */
export async function loadOmpConfig(cwd: string): Promise<OmpConfig> {
	const settings = await config.Settings.loadReadOnly({ cwd });
	return {
		modelRoles: settings.getModelRoles(),
		fallbackChains: sessionSettings.cfgRetryFallbackChains.get(settings),
		retry: {
			...sessionSettings.cfgRetry.get(settings),
			fallbackRevertPolicy: sessionSettings.cfgRetryFallbackRevertPolicy.get(settings),
		},
		modelProviderOrder: modelSettings.cfgModelProviderOrder.get(settings),
		disabledExtensions: extensionSettings.cfgDisabledExtensions.get(settings),
	};
}

function setting(id: string): SettingHandle {
	const handle = settingsRegistry.lookup(id);
	if (!handle) throw new Error(`omp ${ompVersion} has no setting ${id}`);
	return handle;
}

/** The values omp accepts for `retry.<key>`, or `undefined` when it is not an enum. */
export const retryChoices = (key: keyof RetrySettings): readonly string[] | undefined => setting(`retry.${key}`).enumValues;

/** @throws Error, with omp's message, when omp would not write `value` to `retry.<key>`. */
export const assertRetryValue = (key: keyof RetrySettings, value: unknown): void => setting(`retry.${key}`).assertWritable(value);

/**
 * Writes `edit` to the global `config.yml` through omp's own write path, as `omp config set` does: omp re-reads
 * the file under its lock and writes back only the paths the edit set, so every other key survives.
 * The caller has validated `edit`.
 */
export async function writeRouting(cwd: string, edit: RoutingEdit): Promise<void> {
	// Loading a config to write moves one omp cannot parse aside; refuse while it is broken instead.
	await config.Settings.loadReadOnly({ cwd });
	const settings = await config.Settings.loadIsolated({ cwd });
	const setChain = (key: string, fallbacks: string[]): void =>
		setting("retry.fallbackChains").setEntry(settings, key, fallbacks.length > 0 ? fallbacks : undefined);
	switch (edit.kind) {
		case "role":
			if (edit.primary !== undefined) settings.setModelRole(edit.role, edit.primary);
			if (edit.fallbacks !== undefined) setChain(edit.role, edit.fallbacks);
			break;
		case "model-chain":
			setChain(edit.key, edit.fallbacks);
			break;
		case "retry":
			for (const [key, value] of Object.entries(edit.values)) setting(`retry.${key}`).set(settings, value);
			break;
		case "provider-order":
			setting("modelProviderOrder").set(settings, edit.providers.length > 0 ? edit.providers : undefined);
			break;
	}
	await settings.flush();
}

const MODELS_TIMEOUT_MS = 30_000;

/** Every model `omp models` lists for this agent dir, in omp's order. */
export async function listModels(): Promise<CatalogModel[]> {
	const child = Bun.spawn([...ompCommand, "models", "--json"], { stdout: "pipe", stderr: "pipe", timeout: MODELS_TIMEOUT_MS });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	let data: unknown;
	try {
		data = JSON.parse(stdout);
	} catch {
		throw new Error(stderr.trim().split("\n").pop() || `omp models exited with code ${code}`);
	}
	if (!isObject(data) || !Array.isArray(data.models)) throw new Error("omp models --json printed no models");
	return (data.models as unknown[]).flatMap((model): CatalogModel[] =>
		isObject(model) && typeof model.selector === "string" && typeof model.provider === "string"
			? [
					{
						selector: model.selector,
						provider: model.provider,
						name: typeof model.name === "string" ? model.name : model.selector,
						thinking: Array.isArray(model.thinking) ? model.thinking.filter(level => typeof level === "string") : [],
					},
				]
			: [],
	);
}

/** omp capabilities that load files, and the kind of file each loads. */
const FILE_CAPABILITIES: [string, OmpFileKind][] = [
	["context-files", "context"],
	["system-prompt", "system-prompt"],
	["settings", "settings"],
	["slash-commands", "command"],
	["rules", "rule"],
	["skills", "skill"],
	["hooks", "hook"],
];
/** Providers that load installed plugins or omp's bundled defaults, not files the user writes. */
const PACKAGED_PROVIDERS: Record<string, true> = {
	"builtin-defaults": true,
	"agent-plugins": true,
	"claude-plugins": true,
	"omp-plugins": true,
};

export interface FoundFile {
	kind: OmpFileKind;
	scope: "user" | "project";
	path: string;
}

/** The user-written files a session in `cwd` loads, through omp's own discovery. */
export async function discoverOmpFiles(cwd: string, disabledExtensions: string[]): Promise<FoundFile[]> {
	const [capabilityFiles, { agents }] = await Promise.all([
		Promise.all(
			FILE_CAPABILITIES.map(async ([id, kind]) => {
				const { items } = await discovery.loadCapability(id, { cwd, disabledExtensions });
				return items.flatMap(({ _source: source }): FoundFile[] =>
					source.level === "native" || PACKAGED_PROVIDERS[source.provider]
						? []
						: [{ kind, scope: source.level, path: source.path }],
				);
			}),
		),
		agentDiscovery.discoverAgents(cwd),
	]);
	// Plugin agents report the same scopes; the user's own live in omp's `agents` dirs (task/discovery.ts).
	const agentFiles = agents.flatMap(({ source, filePath }): FoundFile[] => {
		if (!filePath || (source !== "user" && source !== "project")) return [];
		const dir = dirname(filePath);
		const own = source === "user" ? dir === join(agentDir, "agents") : dir.endsWith("/.omp/agents");
		return own ? [{ kind: "agent", scope: source, path: filePath }] : [];
	});
	// omp loads the project's APPEND_SYSTEM.md instead of the user's when both exist (main.ts).
	const appendSystem = (["project", "user"] as const).flatMap((scope): FoundFile[] => {
		const path = configFiles.findConfigFile("APPEND_SYSTEM.md", scope === "user" ? { project: false } : { user: false, cwd });
		return path ? [{ kind: "append-system", scope, path }] : [];
	});
	return [...capabilityFiles.flat(), ...appendSystem, ...agentFiles];
}

export const COLLAB_PROTO = protocol.COLLAB_PROTO;

export const listHosts = registry.listCollabHosts;

const rpc = (await import(join(packageDir, "src", "modes", "rpc", "rpc-client.ts"))) as RpcClientModule;
const utils = (await import(join(dirname(packageDir), "pi-utils", "src", "index.ts"))) as UtilsModule;
const dirs = (await import(join(dirname(packageDir), "pi-utils", "src", "dirs.ts"))) as DirsModule;

/** omp's sessions root: one directory per working directory, each holding `<time>_<id>.jsonl` files. */
export const sessionsDir: string = dirs.getSessionsDir();
/** omp's user config directory, `~/.omp/agent` unless `PI_CODING_AGENT_DIR` moves it. */
export const agentDir: string = dirs.getAgentDir();

const HOME = homedir();
/** `path` with the home directory shortened to `~`. */
export const displayPath = (path: string): string =>
	path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
const loader = (await import(join(srcDir, "session", "session-loader.ts"))) as LoaderModule;
const exitDiagnostics = (await import(join(srcDir, "session", "exit-diagnostics.ts"))) as ExitDiagnosticsModule;

/**
 * Whether omp, opening `sessionFile`, would append an abort record because the process that
 * last held it exited mid-turn (omp's `switchSession`). Read-only.
 */
export async function endsMidTurn(sessionFile: string): Promise<boolean> {
	const entries = (await loader.loadEntriesFromFile(sessionFile)).filter(entry => entry.type !== "session");
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	// omp checks the branch from the leaf, which on load is the last entry.
	const branch: FileEntry[] = [];
	const seen = new Set<string>();
	for (let entry = entries.at(-1); entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
		seen.add(entry.id);
		branch.push(entry);
	}
	// omp passes the session's model as the fallback; any model makes this answer cover every case omp repairs.
	const anyModel = { api: "", provider: "", model: "" };
	return exitDiagnostics.createInterruptedTurnAbortMessage(branch.reverse(), anyModel) !== undefined;
}

export interface RpcChild {
	client: RpcClient;
	pid: number;
	/** Settles when the process is gone, however it ended. */
	exited: Promise<unknown>;
}

/**
 * Start this same package's CLI in RPC mode (NDJSON over stdio) in `cwd`, through
 * omp's own `RpcClient`. Resolves once omp reports ready.
 */
export async function startRpc(cwd: string): Promise<RpcChild> {
	let child: RpcProcess | undefined;
	const client = new rpc.RpcClient({
		spawn: agentArgs => {
			child = utils.ptree.spawn([...ompCommand, ...agentArgs], { cwd, stdin: "pipe" });
			return child;
		},
	});
	await client.start();
	if (!child) throw new Error("omp RPC client started without spawning a process");
	// ptree rejects `exited` for a killed child.
	return { client, pid: child.pid, exited: child.exited.catch(() => undefined) };
}

export function linkErrorCode(err: unknown): LinkErrorCode | null {
	return err instanceof registry.CollabLinkError ? err.code : null;
}

/** Every session file under omp's sessions directory, newest first. */
export async function listSessionFiles(): Promise<SavedSession[]> {
	const sessions = await listing.listAllSessions();
	return sessions.map(session => ({
		id: session.id,
		path: session.path,
		cwd: session.cwd,
		// omp writes this placeholder when the prefix it scans holds no user text.
		title:
			session.title ||
			(session.firstMessage && session.firstMessage !== "(no messages)" ? oneLine(session.firstMessage) : null),
		modifiedAt: session.modified.getTime(),
		empty: listing.isEmptySession(session),
	}));
}

export interface Room {
	socket: CollabSocket;
	generation: number;
	access: Access;
	/** base64url write token for `hello`; absent for view links. */
	writeToken: string | undefined;
}

/**
 * Ask the host for a link and open (but not connect) a guest socket for it.
 * The URL and key never leave this function's scope.
 */
export async function openRoom(instanceId: string, access: Access): Promise<Room> {
	const link = await registry.resolveCollabHostLink(instanceId, access);
	const parsed = protocol.parseCollabLink(link.url);
	if ("error" in parsed) throw new Error(`host returned an unparseable link: ${parsed.error}`);
	const key = await crypto.importRoomKey(parsed.key);
	return {
		socket: new relay.CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key }),
		generation: link.generation,
		access: link.access,
		writeToken: parsed.writeToken ? Buffer.from(parsed.writeToken).toString("base64url") : undefined,
	};
}
