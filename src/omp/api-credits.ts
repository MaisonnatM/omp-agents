/**
 * The `anthropic-api` provider in omp's `models.yml`, which bills the Anthropic API key Settings saves under that id.
 * The key cannot sit beside the Anthropic sign-in: omp always picks the sign-in first, so a session never spends the key.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteText } from "../fs";
import { isObject } from "../json";
import { API_CREDITS_PROVIDER } from "../shared/models";
import { agentDir } from "./config";
import type { AuthStorage } from "./module-types/models";

const MARKER = "  # omp-agents: anthropic-api";
const modelsPath = (dir: string): string => join(dir, "models.yml");

/** A model id as a YAML scalar. Quoted when it is not a plain token. */
const yamlId = (id: string): string => (/^[A-Za-z0-9._:-]+$/.test(id) ? id : JSON.stringify(id));

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

const entryText = (ids: readonly string[]): string =>
	[
		MARKER,
		`  ${API_CREDITS_PROVIDER}:`,
		"    baseUrl: https://api.anthropic.com",
		"    api: anthropic-messages",
		"    auth: none",
		"    models:",
		...ids.map(id => `      - id: ${yamlId(id)}`),
	].join("\n");

async function readText(path: string): Promise<string | null> {
	return readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
		if (err.code === "ENOENT") return null;
		throw err;
	});
}

function providersOf(text: string, path: string): Record<string, unknown> {
	const parsed: unknown = Bun.YAML.parse(text);
	if (parsed !== null && !isObject(parsed)) throw new Error(`${path} is not a YAML mapping`);
	const doc = parsed ?? {};
	return isObject(doc.providers) ? doc.providers : {};
}

/**
 * Adds the `anthropic-api` entry to `models.yml` for `ids`, unless the file already has one, which stays as it is.
 * An existing file keeps its text. The entry is inserted under `providers:`. Answers whether it wrote.
 */
export async function addApiCreditsProvider(ids: readonly string[], dir = agentDir): Promise<boolean> {
	const path = modelsPath(dir);
	const text = await readText(path);
	if (text !== null && API_CREDITS_PROVIDER in providersOf(text, path)) return false;
	const block = entryText(ids);
	if (text === null) {
		await atomicWriteText(path, `${block.replace(MARKER, "# omp-agents: anthropic-api\nproviders:\n" + MARKER)}\n`);
	} else {
		await rewrite(path, insertBlock(text, block));
	}
	return true;
}

/** Puts `block` under the first top-level `providers:` key, or appends that key. */
function insertBlock(text: string, block: string): string {
	const match = /^providers:\s*$/m.exec(text);
	if (!match) return `${text.endsWith("\n") ? text : `${text}\n`}providers:\n${block}\n`;
	const at = match.index + match[0].length;
	return `${text.slice(0, at)}\n${block}${text.slice(at)}`;
}

/**
 * Replaces an existing `models.yml` where it really is and with the permissions it had: replacing a symlink would
 * strand omp's config elsewhere, and a file kept private can hold another provider's key.
 */
async function rewrite(path: string, text: string): Promise<void> {
	const target = await realpath(path);
	await atomicWriteText(target, text, (await stat(target)).mode & 0o777);
}

/**
 * Removes the marked `anthropic-api` entry {@link addApiCreditsProvider} wrote, once no key is left for it.
 * An entry without the marker stays, so a file someone else wrote is not reformatted.
 */
export async function removeApiCreditsProvider(dir = agentDir): Promise<void> {
	const path = modelsPath(dir);
	const text = await readText(path);
	if (!text || !text.includes(MARKER)) return;
	const providers = providersOf(text, path);
	const entry = providers[API_CREDITS_PROVIDER];
	if (!isObject(entry) || entry.auth !== "none") return;
	const lines = text.split("\n");
	const start = lines.indexOf(MARKER);
	if (start < 0) return;
	let end = start + 1;
	if (lines[end]?.startsWith(`  ${API_CREDITS_PROVIDER}:`)) end += 1;
	while (end < lines.length && !/^ {0,2}\S/.test(lines[end] ?? "")) end += 1;
	const next = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
	await rewrite(path, next);
}

const KEY_NOT_SAVED = "The API key could not be saved. Check that omp's credential store is available.";
const KEY_NOT_REPLACED = "The API key was saved, but some previous API keys could not be removed. Refresh Providers and remove the old keys.";

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
		throw new Error(KEY_NOT_SAVED, { cause });
	}
	try {
		for (const row of superseded) await credentials.removeById(row.provider, row.id);
	} catch (cause) {
		throw new Error(KEY_NOT_REPLACED, { cause });
	}
}

/**
 * Moves an Anthropic API key that Settings saved beside the sign-in onto `anthropic-api`, and adds that provider to
 * `models.yml` when a key is stored and the file has no entry yet. The file is written first and removed again if the
 * key cannot be moved. The dashboard calls this once at startup, not when a page reads providers. Answers whether models should reload.
 */
export async function settleApiCredits(
	credentials: AuthStorage["credentials"],
	modelIds: () => Promise<readonly string[]>,
	dir = agentDir,
): Promise<boolean> {
	const legacy = credentials.list("anthropic").flatMap(row => (row.credential.type === "api_key" ? [row.credential.key] : []));
	const saved = legacy.length > 0 || credentials.list(API_CREDITS_PROVIDER).some(row => row.credential.type === "api_key");
	if (!saved) return false;
	const wrote = (await listed(dir)) ? false : await addApiCreditsProvider(await modelIds(), dir);
	try {
		if (legacy[0]) await replaceAnthropicApiKey(credentials, legacy[0], AbortSignal.timeout(60_000));
	} catch (error) {
		if (wrote) await removeApiCreditsProvider(dir);
		throw error;
	}
	return wrote || legacy.length > 0;
}

async function listed(dir: string): Promise<boolean> {
	const path = modelsPath(dir);
	const text = await readText(path);
	return text !== null && API_CREDITS_PROVIDER in providersOf(text, path);
}
