/**
 * The `anthropic-api` provider in omp's `models.yml`, which bills the Anthropic API key Settings saves under that id.
 * The key cannot sit beside the Anthropic sign-in: omp always picks the sign-in first, so a session never spends the key.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteText } from "../fs";
import { isObject } from "../json";
import { API_CREDITS_PROVIDER } from "../shared/models";
import { agentDir } from "./config";
import type { AuthStorage } from "./module-types/models";

const modelsPath = (dir: string): string => join(dir, "models.yml");

/**
 * The entry for `ids`, each a model of omp's bundled `anthropic` catalog, which fills in its limits and prices.
 * `auth: none` passes omp's rule that a provider listing models names an `apiKey`, and omp still sends the key stored
 * under the provider's id, so the key stays in the credential store rather than in this file.
 */
export const apiCreditsEntry = (ids: readonly string[]) => ({
	baseUrl: "https://api.anthropic.com",
	api: "anthropic-messages",
	auth: "none",
	models: ids.map(id => ({ id })),
});

async function readModels(path: string): Promise<Record<string, unknown> | null> {
	const text = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
		if (err.code === "ENOENT") return null;
		throw err;
	});
	if (text === null) return null;
	const parsed: unknown = Bun.YAML.parse(text);
	if (parsed !== null && !isObject(parsed)) throw new Error(`${path} is not a YAML mapping`);
	return parsed ?? {};
}

const providersOf = (doc: Record<string, unknown>): Record<string, unknown> => (isObject(doc.providers) ? doc.providers : {});

/**
 * Adds the `anthropic-api` entry to `models.yml` for `ids`, unless the file already has one, which stays as it is.
 * Rewriting the file drops its comments. Answers whether it wrote.
 */
export async function addApiCreditsProvider(ids: readonly string[], dir = agentDir): Promise<boolean> {
	const path = modelsPath(dir);
	const doc = (await readModels(path)) ?? {};
	const providers = providersOf(doc);
	if (API_CREDITS_PROVIDER in providers) return false;
	doc.providers = { ...providers, [API_CREDITS_PROVIDER]: apiCreditsEntry(ids) };
	await atomicWriteText(path, Bun.YAML.stringify(doc, null, 2));
	return true;
}

/**
 * Removes the `anthropic-api` entry {@link addApiCreditsProvider} wrote, once no key is left for it: an `auth: none`
 * provider stays listed in omp's own model picker, where each request would fail without a key.
 */
/**
 * Stores `key` under the API credits provider and removes the API keys stored before it: under that provider with a
 * different value, and under `anthropic`, where Settings saved them before, beside the sign-in that always wins over them.
 * The Anthropic sign-ins stay. A different key does not match omp's upsert, so the old rows are removed after the new one is stored.
 */
export async function replaceAnthropicApiKey(credentials: AuthStorage["credentials"], key: string, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	const superseded = [
		...credentials.list(API_CREDITS_PROVIDER).flatMap(row => (row.credential.type === "api_key" && row.credential.key !== key ? [{ provider: API_CREDITS_PROVIDER, id: row.id }] : [])),
		...credentials.list("anthropic").flatMap(row => (row.credential.type === "api_key" ? [{ provider: "anthropic", id: row.id }] : [])),
	];
	try {
		await credentials.upsert(API_CREDITS_PROVIDER, { type: "api_key", key, source: "login" });
	} catch (cause) {
		throw new Error("The API key could not be saved. Check that omp's credential store is available.", { cause });
	}
	try {
		for (const row of superseded) await credentials.removeById(row.provider, row.id);
	} catch (cause) {
		throw new Error("The API key was saved, but some previous API keys could not be removed. Refresh Providers and remove the old keys.", { cause });
	}
}

/**
 * Moves an Anthropic API key that Settings saved beside the sign-in onto `anthropic-api`, and adds that provider to
 * `models.yml` when a key is stored and the file has no entry yet. Answers whether the caller should reload models.
 */
export async function settleApiCredits(
	credentials: AuthStorage["credentials"],
	modelIds: () => Promise<readonly string[]>,
	dir = agentDir,
): Promise<boolean> {
	const legacy = credentials.list("anthropic").flatMap(row => (row.credential.type === "api_key" ? [row.credential.key] : []));
	const saved = legacy.length > 0 || credentials.list(API_CREDITS_PROVIDER).some(row => row.credential.type === "api_key");
	if (!saved) return false;
	if (legacy[0]) await replaceAnthropicApiKey(credentials, legacy[0], AbortSignal.timeout(60_000));
	const wrote = (await listed(dir)) ? false : await addApiCreditsProvider(await modelIds(), dir);
	return wrote || legacy.length > 0;
}

async function listed(dir: string): Promise<boolean> {
	const doc = await readModels(modelsPath(dir));
	return doc !== null && API_CREDITS_PROVIDER in providersOf(doc);
}

export async function removeApiCreditsProvider(dir = agentDir): Promise<void> {
	const path = modelsPath(dir);
	const doc = await readModels(path);
	if (!doc) return;
	const { [API_CREDITS_PROVIDER]: entry, ...rest } = providersOf(doc);
	if (!isObject(entry) || entry.auth !== "none") return;
	if (Object.keys(rest).length > 0) doc.providers = rest;
	else delete doc.providers;
	await atomicWriteText(path, Bun.YAML.stringify(doc, null, 2));
}
