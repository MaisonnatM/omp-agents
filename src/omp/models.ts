import { isObject } from "../json";
import { runJson } from "../proc";
import { type CatalogModel, type ConnectedModels, type ModelEntry, type ModelRole, selectorOf, splitSelector } from "../shared";
import { loadOmpConfig, type OmpConfig } from "./config";
import { ompCommand } from "./install";
import { auth, oauth, type ServiceTierModel, serviceTiers } from "./modules";

const MODELS_TIMEOUT_MS = 30_000;

/** Every model `omp models` lists for this agent dir, in omp's order. */
export async function listModels(): Promise<CatalogModel[]> {
	const data = await runJson([...ompCommand, "models", "--json"], { timeoutMs: MODELS_TIMEOUT_MS });
	if (!isObject(data) || !Array.isArray(data.models)) throw new Error("omp models --json printed no models");
	return (data.models as unknown[]).flatMap((model): CatalogModel[] =>
		isObject(model) && typeof model.selector === "string" && typeof model.provider === "string"
			? [
					{
						selector: model.selector,
						provider: model.provider,
						name: typeof model.name === "string" ? model.name : model.selector,
						contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
						thinking: Array.isArray(model.thinking) ? model.thinking.filter(level => typeof level === "string") : [],
					},
				]
			: [],
	);
}

/**
 * The providers you are signed in to or gave a key, the ones omp's `/login` marks as connected. omp also lists the models
 * of local runtimes it finds without a login, such as Apple's on-device model; those are not connected. The store opens
 * on each call, so a login from a terminal counts at once.
 */
export async function connectedProviders(): Promise<Set<string>> {
	const storage = await auth.discoverAuthStorage();
	try {
		return new Set(oauth.getOAuthProviders().flatMap(({ id }) => (storage.keys.source(id) === undefined ? [] : [id])));
	} finally {
		storage.close();
	}
}

/** A model as `omp models` or a session's RPC lists it. */
interface ListedModel {
	provider: string;
	id: string;
	name: string;
	contextWindow: number | null;
}

/**
 * The models of `connected` providers as a picker offers them, in their order. `curated` marks the ones `config` names
 * as a role's model or in a fallback chain, with any `:level` dropped; a role alias such as `@slow` names no model of its own.
 */
export function modelEntries(models: readonly ListedModel[], config: Pick<OmpConfig, "modelRoles" | "fallbackChains">, connected: ReadonlySet<string>): ModelEntry[] {
	const known = new Set(models.map(selectorOf));
	const named = [...Object.values(config.modelRoles), ...Object.entries(config.fallbackChains).flatMap(([key, chain]) => [key, ...chain])];
	const curated = new Set(named.map(value => splitSelector(value.trim(), known).model));
	return models.flatMap(({ provider, id, name, contextWindow }) =>
		connected.has(provider) ? [{ provider, id, name, contextWindow, curated: curated.has(`${provider}/${id}`) }] : [],
	);
}

/** What a new session in `cwd` can start on: the models of {@link connectedProviders} that `omp models` lists, in omp's order. */
export async function connectedModels(cwd: string): Promise<ConnectedModels> {
	const [catalog, connected, config] = await Promise.all([listModels(), connectedProviders(), loadOmpConfig(cwd)]);
	const listed = catalog.map(({ selector, provider, name, contextWindow, thinking }) => ({ provider, id: selector.slice(provider.length + 1), name, contextWindow, thinking }));
	return {
		models: modelEntries(listed, config, connected),
		capabilities: listed.filter(({ provider }) => connected.has(provider)).map(({ provider, id, thinking }) => ({ model: { provider, id }, thinkingLevels: thinking })),
	};
}

/** Whether omp's `/fast` can turn on for `model`, as omp's own `setFastMode` decides. */
export function fastAvailable(model: ServiceTierModel): boolean {
	const family = serviceTiers.serviceTierFamily(model);
	return family !== undefined && (family !== "openai" || serviceTiers.shouldSendServiceTier("priority", model));
}

/**
 * omp's `modelRoles` in config order, each as the connected model its selector names. A role that names another
 * (`@slow`, or `*` for `default`) takes that role's model, and its level unless it adds its own `:level`. Roles that
 * name a model by a fuzzy pattern, or one on a provider you are not connected to, are left out: they could not switch.
 */
export function resolveRoles(roles: Record<string, string>, catalog: CatalogModel[], connected: ReadonlySet<string>): ModelRole[] {
	const models = new Map(catalog.map(model => [model.selector, model]));
	const resolve = (value: string, seen: ReadonlySet<string>): { model: CatalogModel; level: string | null } | null => {
		const alias = value === "*" ? "default" : value.startsWith("@") ? value.slice(1) : null;
		if (alias === null) {
			const { model, level } = splitSelector(value, models);
			const listed = models.get(model);
			return listed ? { model: listed, level } : null;
		}
		const colon = alias.indexOf(":");
		const name = colon < 0 ? alias : alias.slice(0, colon);
		const target = roles[name];
		if (target === undefined || seen.has(name)) return null;
		const resolved = resolve(target.trim(), new Set(seen).add(name));
		return resolved && { model: resolved.model, level: colon < 0 ? resolved.level : alias.slice(colon + 1) };
	};
	return Object.entries(roles).flatMap(([role, value]): ModelRole[] => {
		const resolved = resolve(value.trim(), new Set([role]));
		if (!resolved || !connected.has(resolved.model.provider)) return [];
		const { selector, provider } = resolved.model;
		return [{ role, model: { provider, id: selector.slice(provider.length + 1) }, thinking: resolved.level }];
	});
}

/** The roles a session in `cwd` could switch to, from the config it would load: see {@link resolveRoles}. */
export async function connectedRoles(cwd: string): Promise<ModelRole[]> {
	const [config, catalog, connected] = await Promise.all([loadOmpConfig(cwd), listModels(), connectedProviders()]);
	return resolveRoles(config.modelRoles, catalog, connected);
}
