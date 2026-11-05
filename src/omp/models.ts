import { createCache } from "../cache";
import { isObject } from "../json";
import { runJson } from "../proc";
import { API_CREDITS_PROVIDER, type CatalogModel, type ConnectedModels, type DraftModel, type ModelEntry, type ModelRole, selectorOf, splitSelector } from "../shared/models";
import { settleApiCredits } from "./api-credits";
import { loadOmpConfig, type OmpConfig, readSelector, routedSelectors } from "./config";
import { ompCommand } from "./install";
import { auth, config, modelRegistry, modelResolver, oauth, serviceTiers } from "./modules";
import type { OmpSettingsInstance } from "./module-types/config";
import type { CredentialOrigin, ModelRegistryModule, ServiceTierModel } from "./module-types/models";

const MODELS_TIMEOUT_MS = 30_000;

/** How long one `omp models --json` run answers for; a model added to omp's config shows within it. */
const CATALOG_TTL_MS = 30_000;

/** `omp models --json`'s list, kept so a draft's two model reads and every open window share one `omp` run. */
const catalogs = createCache<CatalogModel[]>(CATALOG_TTL_MS);

/** The settings of a directory and omp's model registry, which reads the credential store until `close`. */
export interface OpenRegistry {
	settings: OmpSettingsInstance;
	registry: InstanceType<ModelRegistryModule["ModelRegistry"]>;
	close(): void;
}

/** Loads the settings of `cwd` and the models you can call; the caller closes the credential store once its model calls end. */
export async function openRegistry(cwd: string): Promise<OpenRegistry> {
	const settings = await config.Settings.loadReadOnly({ cwd });
	const storage = await auth.discoverAuthStorage();
	try {
		const registry = new modelRegistry.ModelRegistry(storage);
		await registry.refresh();
		return { settings, registry, close: () => storage.close() };
	} catch (error) {
		storage.close();
		throw error;
	}
}

/** Every model `omp models` lists for this agent dir, in omp's order; one run answers every caller for {@link CATALOG_TTL_MS}. */
export function listModels(): Promise<CatalogModel[]> {
	return catalogs.get("", readCatalog);
}

/** Makes the next {@link listModels} run `omp models` again, once a write changed what it lists. */
export function dropModelList(): void {
	catalogs.drop("");
}

async function readCatalog(): Promise<CatalogModel[]> {
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
 * Sign-in providers that have a credential, plus catalog providers whose key comes from the model config or the
 * credential store, such as the API credits key Settings saves. A missing source is not connected.
 * An `env` key counts for a sign-in provider only: omp reports one for a catalog provider whose variable may hold nothing.
 */
export function connectedProviderIds(
	oauthIds: readonly string[],
	catalogProviders: readonly string[],
	source: (id: string) => CredentialOrigin | undefined,
): Set<string> {
	const ids = oauthIds.flatMap(id => (source(id) === undefined ? [] : [id]));
	const seen = new Set(ids);
	for (const provider of catalogProviders) {
		const kind = source(provider)?.kind;
		if (seen.has(provider) || (kind !== "config" && kind !== "api_key")) continue;
		ids.push(provider);
		seen.add(provider);
	}
	return new Set(ids);
}

/**
 * Catalog providers whose model config sets an API key, once each, plus the API credits row when Settings saved an
 * Anthropic API key under that provider. `omp usage` reports no quota for a key, so no other row stands for it.
 */
export function configuredProviderIds(
	catalogProviders: readonly string[],
	source: (id: string) => CredentialOrigin | undefined,
	anthropicApiKeySaved: boolean,
): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const provider of catalogProviders) {
		if (seen.has(provider)) continue;
		seen.add(provider);
		if (source(provider)?.kind === "config") ids.push(provider);
	}
	if (anthropicApiKeySaved && !ids.includes(API_CREDITS_PROVIDER)) ids.push(API_CREDITS_PROVIDER);
	return ids;
}

/**
 * The providers you are signed in to or gave a key: the ones omp's `/login` marks as connected, and any provider whose
 * model config sets an API key or that has a stored one. Loading the registry installs a config key without running a
 * command that prints it.
 * omp also lists the models of local runtimes it finds without a login, such as Apple's on-device model; those are not
 * connected. The store opens on each call, so a login from a terminal counts at once.
 */
export async function connectedProviders(): Promise<Set<string>> {
	const storage = await auth.discoverAuthStorage();
	try {
		const registry = new modelRegistry.ModelRegistry(storage);
		if (
			await settleApiCredits(storage.credentials, async () => {
				await registry.refresh();
				return registry.getAll().flatMap(model => (model.provider === "anthropic" ? [model.id] : []));
			})
		) {
			dropModelList();
			await registry.refresh();
		}
		return connectedProviderIds(
			oauth.getOAuthProviders().map(({ id }) => id),
			registry.getAvailable().map(model => model.provider),
			id => storage.keys.source(id),
		);
	} finally {
		storage.close();
	}
}

/** {@link configuredProviderIds} from the same registry pass as {@link connectedProviders}, and the stored API credits rows. */
export async function configuredProviders(): Promise<string[]> {
	const storage = await auth.discoverAuthStorage();
	try {
		const registry = new modelRegistry.ModelRegistry(storage);
		return configuredProviderIds(
			registry.getAvailable().map(model => model.provider),
			id => storage.keys.source(id),
			storage.credentials.list(API_CREDITS_PROVIDER).some(row => row.credential.type === "api_key"),
		);
	} finally {
		storage.close();
	}
}

/** A model as `omp models` or a session's RPC lists it. Extra fields ride through {@link modelEntries}. */
interface ListedModel {
	provider: string;
	id: string;
	name: string;
	contextWindow: number | null;
}

/**
 * The models of `connected` providers as a picker offers them: the providers `config.modelProviderOrder` names first, in
 * that order, then the rest, each in omp's order. `curated` marks the models that `config` names as a role's model or in a
 * fallback chain, resolved as omp resolves them, so `cursor/grok-4.7-high` marks `cursor/grok-4.7`; a role alias such as
 * `@slow` and a `provider/*` wildcard name no model of their own. Fields on `models` beyond {@link ListedModel}, such as a
 * draft's thinking levels, stay on each entry.
 */
export function modelEntries<T extends ListedModel>(
	models: readonly T[],
	config: Pick<OmpConfig, "modelRoles" | "fallbackChains" | "modelProviderOrder">,
	connected: ReadonlySet<string>,
): (ModelEntry & Omit<T, keyof ListedModel>)[] {
	const known = new Set(models.map(selectorOf));
	const curated = new Set(
		routedSelectors(config).flatMap(value => {
			const read = readSelector(value, known);
			const model = read && modelResolver.resolveProviderModelReference(read.provider, read.id, models);
			return model ? [selectorOf(model)] : [];
		}),
	);
	const order = config.modelProviderOrder;
	const rank = (provider: string): number => (order.includes(provider) ? order.indexOf(provider) : order.length);
	return models
		.filter(model => connected.has(model.provider))
		.toSorted((a, b) => rank(a.provider) - rank(b.provider))
		.map(model => {
			const { provider, id, name, contextWindow, ...rest } = model;
			return { ...rest, provider, id, name, contextWindow, curated: curated.has(selectorOf(model)) };
		});
}

/** What a new session in `cwd` can start on: the models of {@link connectedProviders} that `omp models` lists, as {@link modelEntries} orders them. */
export async function connectedModels(cwd: string): Promise<ConnectedModels> {
	const [catalog, connected, config] = await Promise.all([listModels(), connectedProviders(), loadOmpConfig(cwd)]);
	const listed: (ListedModel & Pick<DraftModel, "thinkingLevels">)[] = catalog.map(({ selector, provider, name, contextWindow, thinking }) => ({
		provider,
		id: selector.slice(provider.length + 1),
		name,
		contextWindow,
		thinkingLevels: thinking,
	}));
	return { models: modelEntries(listed, config, connected) };
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
