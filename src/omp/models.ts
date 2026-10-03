import { isObject } from "../json";
import { runJson } from "../proc";
import type { CatalogModel, ModelOption } from "../shared";
import { ompCommand } from "./install";
import { auth, oauth } from "./modules";

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

/** The models of {@link connectedProviders} that `omp models` lists, in omp's order: what a new session can start on. */
export async function connectedModels(): Promise<ModelOption[]> {
	const [models, connected] = await Promise.all([listModels(), connectedProviders()]);
	return models.flatMap(({ selector, provider }) => (connected.has(provider) ? [{ provider, id: selector.slice(provider.length + 1) }] : []));
}
