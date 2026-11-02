/** omp's session files (pi-coding-agent src/session) and what a request on one sends. */

/** Subset of omp's `SessionInfo` (src/session/session-listing.ts) this app reads. */
export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	title?: string;
	modified: Date;
	firstMessage: string;
}
export interface ListingModule {
	listAllSessions(storage: unknown, sessionsRoot: string): Promise<SessionInfo[]>;
	/** Scans the `*.jsonl` files `storage` lists in `sessionDir`; omp's scan cache skips files whose stat did not change. */
	listSessionsReadOnly(sessionDir: string, storage: unknown): Promise<SessionInfo[]>;
	isEmptySession(session: SessionInfo): boolean;
	/**
	 * The newest copy of `sessionPath`'s conversation in its directory that holds the turns of the copy it continues, which
	 * `omp --resume` opens; `undefined` when `sessionPath` itself is that copy.
	 */
	findSessionContinuation(sessionPath: string): Promise<{ session: SessionInfo } | undefined>;
}
/** omp's `FileSessionStorage` (src/session/session-storage.ts); the listing's scan cache recognises it by class. */
export interface StorageModule {
	FileSessionStorage: new () => { listFilesSync(dir: string, pattern: string): string[] };
}
/** Subset of omp's `SessionEntry` (src/session/session-entries.ts); the header has `type: "session"`. */
export interface FileEntry extends Record<string, unknown> {
	type: string;
	id: string;
	parentId?: string | null;
}
export interface LoaderModule {
	loadEntriesFromFile(filePath: string): Promise<FileEntry[]>;
	visitEntriesFromFileStream(filePath: string, visit: (entry: FileEntry) => void | boolean, options: { maxRecords: number; maxBytes: number }): Promise<void>;
}
/** omp's session entries (src/session/session-entries.ts): the leaf a load replays to, which a late `model_usage` entry can point back at. */
export interface SessionEntriesModule {
	resolveSessionLeafId(entries: readonly FileEntry[]): string | null;
}
/** omp's session context (src/session/session-context.ts): the messages a request on the branch ending at `leafId` sends. */
export interface SessionContextModule {
	buildSessionContext(entries: FileEntry[], leafId: string | null, byId: Map<string, FileEntry>): { messages: object[] };
}
/** omp's tokenizer (pi-agent-core src/tokenizer.ts): exact counts for the catalog's tokenizer families, else about 4 bytes a token. */
export interface TokenizerModule {
	Tokenizer: new (model: { tokenizer?: string; api: string; provider: string; id: string }) => {
		countMessage(message: object): number;
		countTokens(text: string, mode: "approximate"): number;
	};
}
export interface ModelTokenizerModule {
	/** The tokenizer family pi-catalog knows `modelId` by, `undefined` when it knows none. */
	resolveModelTokenizer(modelId: string, provider: string): string | undefined;
}
export interface ExitDiagnosticsModule {
	createInterruptedTurnAbortMessage(
		entries: readonly FileEntry[],
		fallbackModel?: { api: string; provider: string; model: string },
	): object | undefined;
	createInterruptedToolResults(entries: readonly FileEntry[], context: "fork"): object[];
}
export interface OmpSessionManager {
	getSessionId(): string;
	getCwd(): string;
	getHeader(): Record<string, unknown> | null;
	getEntry(id: string): (FileEntry & Record<string, unknown>) | undefined;
	getEntries(): (FileEntry & Record<string, unknown>)[];
	getBranch(leafId?: string): (FileEntry & Record<string, unknown>)[];
	createBranchedSession(leafId: string, options: { copyArtifacts: boolean }): string | undefined;
	newSession(options?: { parentSession?: string }): Promise<string | undefined>;
	appendMessage(message: object): string;
	appendCustomEntry(customType: string, data: unknown): string;
	appendCustomMessageEntry(customType: string, content: string, display: boolean, details?: unknown, attribution?: "user" | "agent"): string;
	moveTo(cwd: string): Promise<void>;
	setAdditionalDirectories(directories: string[]): Promise<void>;
	/** `false` when omp keeps the old title: a `"user"` title outranks an `"auto"` one, and a title of only whitespace is none. */
	setSessionName(name: string, source: "auto" | "user"): Promise<boolean>;
	getSessionFile(): string | undefined;
	putBlobSync(data: Buffer): { ref: string };
	flush(): Promise<void>;
	close(): Promise<void>;
}
