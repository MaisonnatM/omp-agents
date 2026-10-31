/** The files omp reads for a workspace, and the agent code a project commits, found through omp's own discovery. */
import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { OmpFileKind } from "../shared/models";
import type { ProjectCode, ProjectCodeKind } from "../shared/project-trust";
import { agentDir } from "./config";
import { agentDiscovery, type CapabilityItem, type CapabilityLoadOptions, configFiles, customCommands, discovery } from "./modules";

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

/** The order the trust dialog lists kinds of project code in. */
const KIND_ORDER: ProjectCodeKind[] = ["extension", "hook", "tool", "command", "mcp-server", "settings", "lsp"];
/** The directories whose subdirectories each hold one extension, tool, or slash command package. */
const PACKAGE_PARENTS: Record<string, true> = { extensions: true, tools: true, commands: true };
/** The names omp reads a language server config from, in the project and in each of its config directories (src/utils/config-file-sources.ts). */
const LSP_FILES = ["lsp.json", ".lsp.json", "lsp.yaml", ".lsp.yaml", "lsp.yml", ".lsp.yml"];

const sha256 = (data: string | Uint8Array): string => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** The hash of `file`'s bytes; a file that cannot be read hashes as such, so it asks again once it can. */
const hashFile = async (file: string): Promise<string> => sha256(await readFile(file).catch(() => "unreadable"));

/** The hash of every file under `dir`, by path, leaving out installed dependencies and git's own files. */
async function hashDir(dir: string): Promise<string> {
	const lines: string[] = [];
	const walk = async (at: string): Promise<void> => {
		const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const path = join(at, entry.name);
			if (entry.isDirectory()) await walk(path);
			else lines.push(`${relative(dir, path)}\0${await hashFile(path)}`);
		}
	};
	await walk(dir);
	return sha256(lines.join("\n"));
}

/** `value` as JSON whose text does not depend on the order its keys were written in. */
const stableJson = (value: unknown): string =>
	JSON.stringify(value, (_key, node: unknown) =>
		node !== null && typeof node === "object" && !Array.isArray(node) ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => a.localeCompare(b))) : node,
	);

/**
 * The agent code a session in `cwd` runs that the project, not the user, put there: modules omp imports, MCP servers and
 * settings files, whose values may run commands, and language server configs, each with the filters omp's loaders apply.
 * File ids are paths from `top`, the top of `cwd`'s checkout, with `/` separators, so every checkout of a repository names
 * a piece alike; a file outside `top` keeps its absolute path. Sorted by kind, then id.
 */
export async function discoverProjectCode(cwd: string, top: string): Promise<ProjectCode[]> {
	// omp keeps every file a capability load read for the process's life; a branch pulled since must show its code.
	discovery.reset();
	const realTop = await realpath(top).catch(() => top);
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
	const pathsOf = (items: CapabilityItem[]): string[] => items.map(item => item.path ?? item._source.path);
	const lspDirs = [cwd, ...configFiles.getConfigDirPaths("", { user: false, project: true, cwd })];
	const files: [ProjectCodeKind, string][] = [
		...pathsOf(extensions).map((path): [ProjectCodeKind, string] => ["extension", path]),
		// The extension loader binds only JS and TS hooks (isExtensionFile).
		...pathsOf(hooks).flatMap((path): [ProjectCodeKind, string][] => (path.endsWith(".ts") || path.endsWith(".js") ? [["hook", path]] : [])),
		...pathsOf(tools).map((path): [ProjectCodeKind, string] => ["tool", path]),
		...commands.paths.flatMap(({ path, source }): [ProjectCodeKind, string][] => (source === "project" ? [["command", path]] : [])),
		...pathsOf(settings).map((path): [ProjectCodeKind, string] => ["settings", path]),
		...lspDirs.flatMap(dir => LSP_FILES.map(name => join(dir, name))).filter(path => existsSync(path)).map((path): [ProjectCodeKind, string] => ["lsp", path]),
	];
	const found = [
		...(await Promise.all(
			files.map(async ([kind, path]): Promise<ProjectCode> => {
				const real = await realpath(path).catch(() => path);
				const rel = relative(realTop, real);
				const inside = rel !== "" && !rel.startsWith("..");
				// A package's entry runs the files beside it, so the package directory under extensions/, tools/, or commands/ is what is hashed.
				let pkg: string | null = null;
				if (kind === "extension" || kind === "tool" || kind === "command") {
					for (let child = real, dir = dirname(real); dir !== dirname(dir) && (!inside || dir !== realTop); child = dir, dir = dirname(dir)) {
						if (!PACKAGE_PARENTS[basename(dir)]) continue;
						if (child !== real) pkg = child;
						break;
					}
				}
				return { kind, id: inside ? rel.split(sep).join("/") : real, hash: pkg ? await hashDir(pkg) : await hashFile(real) };
			}),
		)),
		...mcps.flatMap(({ _source, ...server }): ProjectCode[] => (server.name ? [{ kind: "mcp-server", id: `mcp:${server.name}`, hash: sha256(stableJson(server)) }] : [])),
	];
	const byId = new Map(found.map(code => [code.id, code]));
	return [...byId.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}
