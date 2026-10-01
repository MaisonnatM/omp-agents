/**
 * Loads the collab, session-listing, and RPC modules shipped inside the installed
 * omp package so this app speaks the exact protocol, crypto, registry, session-file,
 * and RPC code of the omp version that is running the sessions.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { oneLine } from "./transcript";

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
interface ConfigModule {
	Settings: { loadReadOnly(options: { cwd: string }): Promise<unknown> };
}
interface ExtensionSettingsModule {
	cfgSkills: SettingsReader<Record<string, unknown> & { enableSkillCommands?: boolean }>;
	cfgDisabledExtensions: SettingsReader<string[]>;
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

export const COLLAB_PROTO = protocol.COLLAB_PROTO;

export const listHosts = registry.listCollabHosts;

const rpc = (await import(join(packageDir, "src", "modes", "rpc", "rpc-client.ts"))) as RpcClientModule;
const utils = (await import(join(dirname(packageDir), "pi-utils", "src", "index.ts"))) as UtilsModule;
const dirs = (await import(join(dirname(packageDir), "pi-utils", "src", "dirs.ts"))) as DirsModule;

/** omp's sessions root: one directory per working directory, each holding `<time>_<id>.jsonl` files. */
export const sessionsDir: string = dirs.getSessionsDir();
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
