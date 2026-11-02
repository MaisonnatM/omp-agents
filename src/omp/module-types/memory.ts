/**
 * omp's memory (pi-coding-agent src/memory-backend, src/memories, src/sharpshooter, src/mnemopi, src/hindsight,
 * src/autolearn): the store `memory.backend` picks, read and changed with no session.
 */
import type { OmpSettingsInstance, SettingsReader } from "./config";

/** One of omp's memory backends (`MemoryBackend` in memory-backend/types.ts), as far as a sessionless read uses it. */
export interface MemoryBackend {
	id: string;
	/** The memory block a new session in `cwd` gets in its system prompt, `undefined` when it gets none. */
	buildDeveloperInstructions(agentDir: string, cwd: string, settings: OmpSettingsInstance): Promise<string | undefined>;
}
export interface MemoryBackendModule {
	resolveMemoryBackend(settings: OmpSettingsInstance): Promise<MemoryBackend>;
}
export interface MemoryBackendSettingsModule {
	cfgMemoryBackend: SettingsReader<string>;
}
export interface MemoryRedactModule {
	/** What omp stores in place of `text`: secrets it recognizes replaced, as every memory write does. */
	redactMemorySecrets(text: string): string;
}
export interface AutolearnSettingsModule {
	cfgAutolearnEnabled: SettingsReader<boolean>;
	cfgAutolearnAutoContinue: SettingsReader<boolean>;
}

/** The Local backend's files (memories/index.ts). */
export interface LocalMemoryModule {
	/** The directory a workspace's Local memory lives in, one per exact `cwd`. */
	getMemoryRoot(agentDir: string, cwd: string): string;
	/** Clears the workspace's rows in omp's memory database, then removes {@link getMemoryRoot}. */
	clearMemoryData(agentDir: string, cwd: string): Promise<void>;
	/** Marks the summary for a rebuild, which the next session in `cwd` runs at its start. */
	enqueueMemoryConsolidation(agentDir: string, cwd: string): void;
}

/** The Sharpshooter backend's decision files (sharpshooter/paths.ts, types.ts, queue.ts, backend.ts). */
export interface SharpshooterPathsModule {
	sharpshooterBankDir(agentDir: string, cwd: string): string;
}
export interface SharpshooterTypesModule {
	SHARPSHOOTER_MEMORY_FILES: readonly string[];
}
export interface SharpshooterQueueModule {
	/** How many sessions wait for the background consolidation into the decision files. */
	sharpshooterQueueDepth(agentDir: string, cwd: string): Promise<number>;
}
export interface SharpshooterBackendModule {
	sharpshooterBackend: { clear(agentDir: string, cwd: string): Promise<void> };
}

/** The Mnemopi backend's config (mnemopi/config.ts), its banks (mnemopi/state.ts) and its library (pi-mnemopi). */
export interface MnemopiConfig {
	scoping: "global" | "per-project" | "per-project-tagged";
	globalBank: string;
	retainBank: string;
	recallBanks: readonly string[];
	providerOptions: Record<string, unknown>;
	proactiveLinking?: boolean;
	polyphonicRecall?: boolean;
	enhancedRecall?: boolean;
}
export interface MnemopiConfigModule {
	/** The Mnemopi config a session in `settings`' cwd uses. */
	loadMnemopiConfig(settings: OmpSettingsInstance, agentDir: string): MnemopiConfig;
}
export interface MnemopiStateModule {
	/** Every bank a session's Mnemopi opens, and each one's database in the same order, which needs {@link loadMnemopiCore} first. */
	getMnemopiScopedBanks(config: MnemopiConfig): readonly string[];
	getMnemopiScopedDbPaths(config: MnemopiConfig): readonly string[];
	loadMnemopiCore(): Promise<unknown>;
	loadMnemopi(): Promise<{ Mnemopi: new (options: Record<string, unknown>) => MnemopiMemory }>;
}
/** One open bank (pi-mnemopi src/core/memory.ts `Mnemopi`). */
export interface MnemopiMemory {
	/** The row `id` names among the working and episodic rows and the facts this bank's session sees, `null` when none. */
	get(id: string): { content?: unknown; memory_store?: unknown } | null;
	update(id: string, content: string | null): boolean;
	forget(id: string): boolean;
	beam: { invalidate(id: string, replacementId: string | null): boolean };
	/** Waits for the embedding an edit scheduled. */
	flushExtractions(): Promise<void>;
	close(): void;
}

/** The Hindsight backend's config, bank and client (hindsight/config.ts, bank.ts, client.ts). */
export interface HindsightConfig {
	hindsightApiUrl: string | null;
	scoping: "global" | "per-project" | "per-project-tagged";
}
export interface HindsightConfigModule {
	loadHindsightConfig(settings: OmpSettingsInstance): HindsightConfig;
	isHindsightConfigured(config: HindsightConfig): boolean;
}
export interface HindsightBankModule {
	computeBankScope(config: HindsightConfig, directory: string): { bankId: string };
}
export interface HindsightClientModule {
	createHindsightClient(config: HindsightConfig): {
		/** omp types the answer as an open record; its shape is the Hindsight server's. */
		listMemories(bankId: string, options: { limit: number }): Promise<Record<string, unknown>>;
	};
}
