/** The settings page: omp's model routing and the files omp reads, as a session in a workspace would load them. */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentDir, discoverOmpFiles, displayPath, expandDefaultRetryFallbackChains, type FoundFile, loadOmpConfig } from "./omp";
import type { ModelChain, OmpFile, OmpSettings, RoleRoute } from "./shared";

/**
 * Every role omp knows a model or a chain for, in config order, with the fallbacks omp walks for it.
 * Chain keys with a `/` name a model or provider wildcard rather than a role (omp's `isRetryFallbackModelKey`).
 */
export function routeRoles(
	modelRoles: Record<string, string>,
	configuredChains: Record<string, string[]>,
): { roles: RoleRoute[]; modelChains: ModelChain[] } {
	const chainKeys = Object.keys(configuredChains);
	const roleNames = [...new Set([...Object.keys(modelRoles), ...chainKeys.filter(key => !key.includes("/"))])];
	const effective = expandDefaultRetryFallbackChains(configuredChains, roleNames);
	return {
		roles: roleNames.map(role => ({
			role,
			primary: modelRoles[role] ?? null,
			fallbacks: effective[role] ?? [],
			inheritsDefault: configuredChains[role] === undefined && effective[role] !== undefined,
		})),
		modelChains: chainKeys.filter(key => key.includes("/")).map(key => ({ key, fallbacks: configuredChains[key] ?? [] })),
	};
}

/** Reading a file never throws: a file that is not there or cannot be read says so. */
async function readFile({ kind, scope, path }: FoundFile): Promise<OmpFile> {
	let body: OmpFile["body"];
	try {
		const [info, text] = await Promise.all([stat(path), Bun.file(path).text()]);
		body = { state: "read", size: info.size, modifiedAt: info.mtimeMs, text };
	} catch (err) {
		body =
			(err as NodeJS.ErrnoException).code === "ENOENT"
				? { state: "missing" }
				: { state: "unreadable", error: err instanceof Error ? err.message : String(err) };
	}
	return { kind, scope, path, pathDisplay: displayPath(path), body };
}

/** Files omp reads from its own directory, listed even before they exist so the page shows where they go. */
const USER_FILES: FoundFile[] = [
	{ kind: "context", scope: "user", path: join(agentDir, "AGENTS.md") },
	{ kind: "settings", scope: "user", path: join(agentDir, "config.yml") },
];

/**
 * omp's settings and files for a session in `cwd`, or user-level only when `cwd` is `null`.
 * A config omp cannot load still lists the files, so the page can show the broken `config.yml`.
 */
export async function loadOmpSettings(cwd: string | null): Promise<OmpSettings> {
	const sessionCwd = cwd ?? homedir();
	let routing: OmpSettings["routing"];
	let disabledExtensions: string[] = [];
	try {
		const config = await loadOmpConfig(sessionCwd);
		disabledExtensions = config.disabledExtensions;
		routing = {
			...routeRoles(config.modelRoles, config.fallbackChains),
			retry: config.retry,
			modelProviderOrder: config.modelProviderOrder,
		};
	} catch (err) {
		routing = { error: err instanceof Error ? err.message : String(err) };
	}
	// From the home directory omp reads other tools' dot-directories as project files; without a workspace there is no project.
	const found = (await discoverOmpFiles(sessionCwd, disabledExtensions)).filter(file => cwd !== null || file.scope === "user");
	const placeholders = USER_FILES.filter(file => !found.some(other => other.kind === file.kind && other.scope === "user"));
	return { cwd, routing, files: await Promise.all([...found, ...placeholders].map(readFile)) };
}
