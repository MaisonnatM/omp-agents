/** The files omp reads for a workspace, and the agent code a project commits, found through omp's own discovery. */
import { dirname, join } from "node:path";
import type { OmpFileKind } from "../shared/models";
import type { ProjectCodeKind } from "../shared/project-trust";
import { agentDir } from "./config";
import { agentDiscovery, configFiles, configSources, customCommands, discovery } from "./modules";
import type { CapabilityItem, CapabilityLoadOptions } from "./module-types/discovery";

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

/** `name` is the name omp resolved for a skill or slash command; `frontmatter` is a skill's, as omp parsed it. */
export interface FoundFile {
	kind: OmpFileKind;
	scope: "user" | "project";
	path: string;
	name?: string;
	frontmatter?: Record<string, unknown>;
}

/** The user-written files a session in `cwd` loads, through omp's own discovery. */
export async function discoverOmpFiles(cwd: string, disabledExtensions: string[]): Promise<FoundFile[]> {
	const [capabilityFiles, { agents }] = await Promise.all([
		Promise.all(
			FILE_CAPABILITIES.map(async ([id, kind]) => {
				const { items } = await discovery.loadCapability(id, { cwd, disabledExtensions });
				return items.flatMap(({ _source: source, name, frontmatter }): FoundFile[] =>
					source.level === "native" || PACKAGED_PROVIDERS[source.provider]
						? []
						: [{ kind, scope: source.level, path: source.path, name, frontmatter }],
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

/** A file of a project's own agent code that a session would load, as omp names it. */
export interface ProjectFile {
	kind: Exclude<ProjectCodeKind, "mcp-server">;
	path: string;
}

/** An MCP server the project's settings configure, by the name omp resolved, with every field omp read for it. */
export interface ProjectMcpServer {
	name: string;
	config: Record<string, unknown>;
}

const ofKind = (kind: ProjectFile["kind"], paths: string[]): ProjectFile[] => paths.map(path => ({ kind, path }));

/** The file of an extension, hook, tool, or settings item, which omp always names (src/capability/*.ts); one with none fails the census, as it could not be hashed. */
function pathOf({ path, _source }: CapabilityItem): string {
	if (path === undefined) throw new Error(`omp's ${_source.provider} provider found an item in ${_source.path} with no file`);
	return path;
}

/**
 * Empties omp's capability file cache, which keeps every file a load read for the process's life. It is the whole
 * process's cache, so the next {@link discoverOmpFiles} reads the disk again too.
 */
export function forgetReadFiles(): void {
	discovery.reset();
}

/**
 * The agent code a session in `cwd` would load that the project, not the user, put there: modules omp imports, MCP
 * servers and settings files, whose values may run commands, and language server configs, each with the filters omp's
 * loaders apply. It reads through omp's file cache; call {@link forgetReadFiles} first for files changed since.
 */
export async function discoverProjectCode(cwd: string): Promise<{ files: ProjectFile[]; mcpServers: ProjectMcpServer[] }> {
	const projectItems = async (id: string, options: Pick<CapabilityLoadOptions, "providers" | "filter"> = {}) =>
		(await discovery.loadCapability(id, { cwd, ...options })).items.filter(item => item._source.level === "project");
	const [extensions, hooks, tools, mcps, settings, commands] = await Promise.all([
		// The extension loader asks only omp's own provider; .claude, .codex, .gemini, and .opencode extension modules never load.
		projectItems("extension-modules", { providers: ["native"] }),
		projectItems("hooks"),
		// The custom-tools loader imports only these, filtered before omp dedupes by name; a tool's JSON, Markdown, or shell file runs nothing.
		projectItems("tools", { filter: item => /\.(ts|js|mjs|cjs)$/.test(item.path ?? "") && !item.path?.endsWith(".d.ts") }),
		projectItems("mcps"),
		projectItems("settings"),
		customCommands.discoverCustomCommands({ cwd }),
	]);
	// omp's LSP loader (lsp/config.ts) reads `cwd`'s config files and its config directories' before the user's; the
	// census keeps those. At the home directory a file is both the project's and the user's, so it comes twice.
	const projectDirs = new Set([cwd, ...configFiles.getConfigDirPaths("", { user: false, project: true, cwd })]);
	const lspFiles = configSources.configFileSources("lsp", cwd, (_content, path) => (projectDirs.has(dirname(path)) ? path : null)).flatMap(source => source.read() ?? []);
	const files = [
		...ofKind("extension", extensions.map(pathOf)),
		// The extension loader binds only JS and TS hooks (isExtensionFile).
		...ofKind("hook", hooks.map(pathOf).filter(path => path.endsWith(".ts") || path.endsWith(".js"))),
		...ofKind("tool", tools.map(pathOf)),
		...ofKind("command", commands.paths.flatMap(({ path, source }) => (source === "project" ? [path] : []))),
		...ofKind("settings", settings.map(pathOf)),
		...ofKind("lsp", [...new Set(lspFiles)]),
	];
	// omp names every MCP server (src/capability/mcp.ts); one with no name fails the census, as it could not be hashed.
	const mcpServers = mcps.map(({ _source, ...config }): ProjectMcpServer => {
		if (config.name === undefined) throw new Error(`omp's ${_source.provider} provider found an MCP server in ${_source.path} with no name`);
		return { name: config.name, config };
	});
	return { files, mcpServers };
}
