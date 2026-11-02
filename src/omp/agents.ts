/** Settings › Agents reads omp's winning definitions and resolves their persisted model choices without starting a session. */
import { sep } from "node:path";
import { errorText, isObject } from "../json";
import { HOME } from "../paths";
import type { AgentCatalog, AgentDefinitionPreview, AgentModelOverride } from "../shared/agents";
import { readAgentSettings } from "./agent-settings";
import { loadSessionSettings } from "./config";
import type { OmpSettingsInstance } from "./module-types/config";
import type { OmpModel } from "./module-types/models";
import { agentDiscovery, agentPluginRoots, agentReadOnly, agentRoots, auth, modelRegistry, modelResolver, settingsRegistry } from "./modules";

export const AGENT_EXECUTION_IDS = ["task.maxConcurrency", "task.isolation.enabled", "task.isolation.apply", "task.isolation.merge"] as const;

function taskLayer(layer: Record<string, unknown>): Record<string, unknown> {
	return isObject(layer.task) ? layer.task : {};
}

function overridesOf(layer: Record<string, unknown>): Record<string, AgentModelOverride> {
	const value = taskLayer(layer).agentModelOverrides;
	return isObject(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, AgentModelOverride] => typeof entry[1] === "string" || (Array.isArray(entry[1]) && entry[1].every(value => typeof value === "string")))) : {};
}

/** A marker lets omp itself decide whether a definition inherits its parent's model, including its legacy aliases. */
const PARENT_MODEL = "__omp_agents_parent_model__";

export async function readAgentCatalog(cwd: string | null, loaded: OmpSettingsInstance): Promise<AgentCatalog> {
	// A user preview must discover without the home's project agents shadowing a user or bundled definition.
	const discoveryCwd = cwd ?? "/";
	const settings = cwd === null ? await loadSessionSettings(discoveryCwd) : loaded;
	const userOverrides = overridesOf(settings.getGlobalSettings());
	const workspaceOverrides = cwd === null ? {} : overridesOf(settings.getProjectSettings());
	const overrides = overridesOf({ task: { agentModelOverrides: settingsRegistry.lookup("task.agentModelOverrides")!.get(settings) } });
	const disabled = settingsRegistry.lookup("task.disabledAgents")!.get(settings) as string[];
	const [{ agents }, packages, plugins] = await Promise.all([
		agentDiscovery.discoverAgents(discoveryCwd),
		agentRoots.listOmpExtensionRoots({ cwd: discoveryCwd, home: HOME, repoRoot: null }),
		agentPluginRoots.listClaudePluginRoots(HOME, discoveryCwd),
	]);
	const roots = [...packages, ...plugins.roots.map(root => ({ path: root.path, name: root.plugin, level: root.scope }))].sort((a, b) => b.path.length - a.path.length);
	let pool: OmpModel[] = [];
	let modelError: string | undefined;
	try {
		const storage = await auth.discoverAuthStorage();
		try {
			// No refresh: inspection must not fetch provider catalogs or make a model request.
			pool = new modelRegistry.ModelRegistry(storage).getAvailable();
		} finally {
			storage.close();
		}
	} catch (err) {
		modelError = errorText(err);
	}
	const rows = agents.filter(agent => cwd !== null || agent.source !== "project").map((agent): AgentDefinitionPreview => {
		const root = agent.filePath && roots.find(root => agent.filePath!.startsWith(`${root.path}${sep}`));
		const seance = agent.name === "seance" && agent.source === "bundled";
		const selection = modelResolver.resolveAgentModelSelection({ settingsOverride: seance ? undefined : overrides[agent.name], agentModel: agent.model, settings, activeModelPattern: PARENT_MODEL });
		const inherited = selection.patterns.includes(PARENT_MODEL);
		const effective = inherited || seance ? [] : selection.patterns;
		const resolved = modelResolver.resolveModelOverride(effective, { getAvailable: () => pool }, settings);
		return {
			name: agent.name, description: agent.description, scope: agent.source,
			origin: agent.source === "bundled" ? "bundled" : root ? "plugin" : "native",
			...(root ? { package: root.name } : {}), ...(agent.filePath ? { path: agent.filePath } : {}),
			tools: agent.tools ?? null, readOnly: agentReadOnly.isReadOnlyAgent(agent), disabled: disabled.includes(agent.name),
			definition: agent.model ?? [],
			...(Object.hasOwn(userOverrides, agent.name) ? { user: userOverrides[agent.name] } : {}),
			...(Object.hasOwn(workspaceOverrides, agent.name) ? { workspace: workspaceOverrides[agent.name] } : {}),
			effective,
			model: seance ? { kind: "source-session" } : inherited ? { kind: "inherited" } : resolved.model ? { kind: "resolved", selector: `${resolved.model.provider}/${resolved.model.id}`, ...(resolved.thinkingLevel ? { thinking: resolved.thinkingLevel } : {}) } : { kind: "unresolved", ...(resolved.warning ? { warning: resolved.warning } : {}) },
		};
	}).sort((a, b) => a.name.localeCompare(b.name));
	const panel = readAgentSettings(settings, cwd !== null);
	return {
		context: cwd === null ? "user-preview" : "workspace-preview", cwd, agents: rows, userOverrides,
		roles: Object.keys(settings.getModelRoles()),
		execution: panel.tabs.flatMap(tab => tab.groups.flatMap(group => group.rows)).filter(row => (AGENT_EXECUTION_IDS as readonly string[]).includes(row.id)),
		...(modelError ? { modelError } : {}),
	};
}
