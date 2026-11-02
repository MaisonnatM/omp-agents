/** Settings › Agents reads omp's winning definitions and resolves their persisted model choices without starting a session. */
import { sep } from "node:path";
import { errorText, isObject } from "../json";
import { HOME } from "../paths";
import { AGENT_SETTINGS, type AgentCatalog, type AgentDefinitionPreview, type AgentModelOverride, isAgentModelOverride } from "../shared/agents";
import type { OmpSettingsInstance } from "./module-types/config";
import type { OmpModel } from "./module-types/models";
import { agentDiscovery, agentPluginRoots, agentReadOnly, agentRoots, auth, modelRegistry, modelResolver, settingsRegistry } from "./modules";

function taskLayer(layer: Record<string, unknown>): Record<string, unknown> {
	return isObject(layer.task) ? layer.task : {};
}

function parseOverrides(value: unknown): Record<string, AgentModelOverride> {
	return isObject(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, AgentModelOverride] => isAgentModelOverride(entry[1]))) : {};
}

function overridesOf(layer: Record<string, unknown>): Record<string, AgentModelOverride> {
	return parseOverrides(taskLayer(layer).agentModelOverrides);
}

/** A marker lets omp itself decide whether a definition inherits its parent's model, including its legacy aliases. */
const PARENT_MODEL = "__omp_agents_parent_model__";

export async function readAgentCatalog(cwd: string | null, settings: OmpSettingsInstance): Promise<AgentCatalog> {
	// A user preview must discover without the home's project agents shadowing a user or bundled definition.
	const discoveryCwd = cwd ?? "/";
	const userOverrides = overridesOf(settings.getGlobalSettings());
	const workspaceOverrides = cwd === null ? {} : overridesOf(settings.getProjectSettings());
	const overrides = parseOverrides(settingsRegistry.lookup(AGENT_SETTINGS.overrides)!.get(settings));
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
			seance,
			definition: agent.model ?? [],
			...(Object.hasOwn(userOverrides, agent.name) ? { user: userOverrides[agent.name] } : {}),
			...(Object.hasOwn(workspaceOverrides, agent.name) ? { workspace: workspaceOverrides[agent.name] } : {}),
			effective,
			model: seance ? { kind: "source-session" } : inherited ? { kind: "inherited" } : resolved.model ? { kind: "resolved", selector: `${resolved.model.provider}/${resolved.model.id}`, ...(resolved.thinkingLevel ? { thinking: resolved.thinkingLevel } : {}) } : { kind: "unresolved", ...(resolved.warning ? { warning: resolved.warning } : {}) },
		};
	}).sort((a, b) => a.name.localeCompare(b.name));
	return {
		context: cwd === null ? "user-preview" : "workspace-preview", cwd, agents: rows, userOverrides,
		roles: Object.keys(settings.getModelRoles()),
		...(modelError ? { modelError } : {}),
	};
}
