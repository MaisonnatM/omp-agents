import { describe, expect, test } from "bun:test";
import type { AuthStorage, StoredCredential } from "./module-types/models";
import { loginProvider, replaceAnthropicApiKey, type LoginHooks } from "./providers";

const signal = new AbortController().signal;

function hooks(value: string): LoginHooks {
	return { onAuth() {}, onProgress() {}, onPrompt: async () => value, signal };
}

/** An in-memory credential store across providers. Upsert adds an API key, as omp does when the key value changes. */
function store(rows: StoredCredential[]) {
	let next = rows.reduce((max, row) => Math.max(max, row.id), 0);
	const removed: number[] = [];
	const credentials: AuthStorage["credentials"] = {
		hasOAuth: provider => rows.some(row => row.provider === provider && row.credential.type === "oauth"),
		list: provider => rows.filter(row => row.provider === provider).map(row => ({ ...row, credential: { ...row.credential } })),
		set: async () => {},
		upsert: async (provider, credential) => {
			if (rows.some(row => row.provider === provider && row.credential.type === "api_key" && row.credential.key === credential.key)) return;
			expect(credential).toEqual({ type: "api_key", key: credential.key, source: "login" });
			rows.push({ id: ++next, provider, credential: { type: "api_key", key: credential.key } });
		},
		removeById: async (provider, credentialId) => {
			const index = rows.findIndex(row => row.provider === provider && row.id === credentialId);
			if (index < 0) return false;
			rows.splice(index, 1);
			removed.push(credentialId);
			return true;
		},
	};
	return { rows, removed, credentials };
}

const oauth = (id: number): StoredCredential => ({ id, provider: "anthropic", credential: { type: "oauth" } });
const apiKey = (id: number, key: string, provider = "anthropic-api"): StoredCredential => ({ id, provider, credential: { type: "api_key", key } });

describe("Anthropic API key", () => {
	test("a blank or multiline key is refused before the credential store opens", async () => {
		await expect(loginProvider("anthropic-api-key", "anthropic-api", hooks("  "))).rejects.toThrow("Enter a non-empty API key on one line.");
		await expect(loginProvider("anthropic-api-key", "anthropic-api", hooks("line\nkey"))).rejects.toThrow("Enter a non-empty API key on one line.");
		await expect(loginProvider("anthropic-api-key", "anthropic-api", hooks("x".repeat(8193)))).rejects.toThrow("Enter a non-empty API key on one line.");
	});

	test("saving a key files it under API credits and removes the previous keys there and beside the Anthropic sign-in", async () => {
		const { rows, removed, credentials } = store([oauth(1), apiKey(2, "old-key", "anthropic"), oauth(3), apiKey(4, "other-old-key")]);
		await replaceAnthropicApiKey(credentials, "new-key", signal);
		expect(rows.filter(row => row.credential.type === "oauth").map(row => row.id)).toEqual([1, 3]);
		expect(rows.filter(row => row.credential.type === "api_key")).toEqual([apiKey(5, "new-key")]);
		expect(removed.toSorted()).toEqual([2, 4]);
	});

	test("saving the same key leaves that row and the subscription accounts", async () => {
		const { rows, removed, credentials } = store([oauth(1), apiKey(2, "same-key")]);
		await replaceAnthropicApiKey(credentials, "same-key", signal);
		expect(removed).toEqual([]);
		expect(rows).toEqual([oauth(1), apiKey(2, "same-key")]);
	});

	test("a key that cannot be removed stays saved and reports the cleanup", async () => {
		const { credentials } = store([apiKey(1, "old-key")]);
		credentials.removeById = async () => {
			throw new Error("store busy");
		};
		await expect(replaceAnthropicApiKey(credentials, "new-key", signal)).rejects.toThrow("some previous API keys could not be removed");
		expect(credentials.list("anthropic-api").some(row => row.credential.type === "api_key" && row.credential.key === "new-key")).toBe(true);
	});

	test("a store that rejects the new key removes nothing", async () => {
		const { rows, credentials } = store([oauth(1), apiKey(2, "old-key", "anthropic")]);
		credentials.upsert = async () => {
			throw new Error("store busy");
		};
		await expect(replaceAnthropicApiKey(credentials, "new-key", signal)).rejects.toThrow("could not be saved");
		expect(rows.map(row => row.id)).toEqual([1, 2]);
	});

	test("cancellation before the store is open removes nothing", async () => {
		const { rows, credentials } = store([apiKey(1, "old-key")]);
		const aborted = new AbortController();
		aborted.abort();
		await expect(replaceAnthropicApiKey(credentials, "new-key", aborted.signal)).rejects.toThrow("aborted");
		expect(rows).toEqual([apiKey(1, "old-key")]);
	});
});
