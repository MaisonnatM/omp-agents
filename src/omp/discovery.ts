/** The files omp reads for a workspace, found through omp's own discovery. */
import { dirname, join } from "node:path";
import type { OmpFileKind } from "../shared/models";
import { agentDir } from "./config";
import { agentDiscovery, configFiles, discovery } from "./modules";

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
