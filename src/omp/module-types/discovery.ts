/** omp's discovery of what a session loads (skills, slash commands, completions, capabilities, agents, config files), and its document conversion. */
import type { AutocompleteProvider, FileSlashCommand, Skill } from "../prompts";

export interface AutocompleteModule {
	CombinedAutocompleteProvider: new (
		commands: { name: string; description?: string }[],
		basePath: string,
	) => AutocompleteProvider;
}
export interface SkillsModule {
	loadSkills(options: Record<string, unknown> & { cwd: string }): Promise<{ skills: Skill[] }>;
	parseSkillInvocation(text: string): { name: string; args: string; prompt: string } | undefined;
	buildSkillPromptMessage(skill: Skill, input: { args: string; prompt?: string }): Promise<{ message: string }>;
}
export interface SlashCommandsModule {
	loadSlashCommands(options: { cwd: string }): Promise<FileSlashCommand[]>;
	expandSlashCommand(text: string, fileCommands: FileSlashCommand[]): string;
}
/**
 * Subset of omp's capability items (src/capability/types.ts): every item names the file it came from. `name` is a skill's, a
 * slash command's, or an MCP server's resolved name (src/capability/skill.ts, slash-command.ts, mcp.ts); `frontmatter` is a
 * skill's parsed frontmatter. `path` is the module an extension, hook, or tool loads, or a settings file.
 */
export interface CapabilityItem {
	_source: { provider: string; path: string; level: "user" | "project" | "native" };
	name?: string;
	frontmatter?: Record<string, unknown>;
	path?: string;
}
/** `providers` loads only those providers' items (src/capability/types.ts LoadOptions); `filter` drops items before omp dedupes them by name. */
export interface CapabilityLoadOptions {
	cwd: string;
	disabledExtensions?: string[];
	providers?: string[];
	filter?: (item: CapabilityItem) => boolean;
}
export interface DiscoveryModule {
	loadCapability(id: string, options: CapabilityLoadOptions): Promise<{ items: CapabilityItem[] }>;
	/** Empties the file cache capability loads read through (src/capability/fs.ts), which otherwise keeps every file it read for the process's life. */
	reset(): void;
}
/** omp's TypeScript slash commands (src/extensibility/custom-commands/loader.ts): the module of each, and whose it is. */
export interface CustomCommandsModule {
	discoverCustomCommands(options: { cwd: string }): Promise<{ paths: { path: string; source: "bundled" | "user" | "project" }[] }>;
}
export interface AgentDefinition {
	name: string;
	description: string;
	source: "user" | "project" | "bundled";
	filePath?: string;
	tools?: string[];
	model?: string[];
}
export interface AgentDiscoveryModule {
	discoverAgents(cwd: string): Promise<{ agents: AgentDefinition[] }>;
}
export interface AgentReadOnlyModule {
	isReadOnlyAgent(agent: AgentDefinition): boolean;
}
export interface AgentRootsModule {
	listOmpExtensionRoots(context: { cwd: string; home: string; repoRoot: null }): Promise<{ path: string; name: string; level: "user" | "project" }[]>;
}
export interface AgentPluginRootsModule {
	listClaudePluginRoots(home: string, cwd: string): Promise<{ roots: { path: string; plugin: string; scope: "user" | "project" }[] }>;
}
export interface ConfigFilesModule {
	findConfigFile(subpath: string, options: { user?: boolean; project?: boolean; cwd?: string }): string | undefined;
	/** The config directories `subpath` is looked up in, such as `<cwd>/.omp`, `.pi`, and `.claude` for the project. */
	getConfigDirPaths(subpath: string, options: { user?: boolean; project?: boolean; cwd?: string }): string[];
}
/** omp's document conversion (src/utils/markit.ts), the one its read tool and `@file` arguments use. */
export interface MarkitModule {
	convertBufferWithMarkit(buffer: Uint8Array, extension: string): Promise<{ content: string; ok: boolean; error?: string }>;
}
/**
 * omp's config file stack (src/utils/config-file-sources.ts): every file of base name `base`, such as `lsp.json` and
 * `.lsp.yml`, in `cwd`, then its project config directories, the user's, plugin roots, and the home directory. `read`
 * yields what `adapt` returns for the file, `null` when it could not be read.
 */
export interface ConfigFileSourcesModule {
	configFileSources<T>(base: string, cwd: string, adapt: (content: string, filePath: string) => T | null): { read(): T | null }[];
}
