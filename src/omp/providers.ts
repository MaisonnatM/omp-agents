/**
 * omp's model-provider sign-ins, as `omp login` and `/logout` run them: the `/login` providers grouped by the provider their
 * credentials are filed under, the sign-in itself, and removing one stored credential. The credential store opens and
 * closes on each call, so a sign-in from a terminal shows at the next read.
 */
import type { AuthStorage, CredentialOrigin, OAuthLoginController } from "./module-types/models";
import { auth, browserSession, logout, modelRegistry, oauth, oauthTerminal } from "./modules";
import { ANTHROPIC_API_KEY_METHOD, MAX_LOGIN_ANSWER, type ModelProvider } from "../shared/providers";

/** The callbacks a sign-in reports through; omp adds the isolated browser that a cookie sign-in opens. */
export type LoginHooks = Omit<OAuthLoginController, "onBrowserSession">;

const KEY_NOT_SAVED = "The API key could not be saved. Check that omp's credential store is available.";
const KEY_NOT_REPLACED = "The API key was saved, but some previous API keys could not be removed. Refresh Providers and remove the old keys.";
const MODELS_NOT_REFRESHED = "The API key was saved, but models could not refresh. Refresh Providers before trying again.";

/**
 * Stores `key` as Anthropic's login API key and removes API keys that were already stored with a different value.
 * OAuth rows stay. A different key does not match omp's upsert, so the old rows are removed after the new one is stored.
 */
export async function replaceAnthropicApiKey(credentials: AuthStorage["credentials"], key: string, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	const superseded = credentials.list("anthropic").filter(row => row.credential.type === "api_key" && row.credential.key !== key);
	try {
		await credentials.upsert("anthropic", { type: "api_key", key, source: "login" });
	} catch (cause) {
		throw new Error(KEY_NOT_SAVED, { cause });
	}
	try {
		for (const row of superseded) await credentials.removeById("anthropic", row.id);
	} catch (cause) {
		throw new Error(KEY_NOT_REPLACED, { cause });
	}
}

/** The environment variable omp reads `provider`'s key from, when no stored credential takes precedence over it. */
const envKeyOf = (origin: CredentialOrigin | undefined): string | null => (origin?.kind === "env" ? (origin.envVar ?? "an environment variable") : null);

/** Every available `/login` entry, grouped by the provider its credentials are filed under, in omp's order. */
export async function listProviders(): Promise<ModelProvider[]> {
	const storage = await auth.discoverAuthStorage();
	try {
		const providers = new Map<string, ModelProvider>();
		for (const { id, name, available, storeCredentialsAs } of oauth.getOAuthProviders()) {
			if (!available) continue;
			const key = storeCredentialsAs ?? id;
			const known = providers.get(key);
			if (known) {
				known.methods.push({ id, name });
				if (id === key) known.name = name;
				continue;
			}
			const accounts = logout.toLogoutAccounts(key, storage.credentials.list(key)).map(({ credentialId, label, detail, type }) => ({ credentialId, label, detail, kind: type }));
			providers.set(key, { id: key, name, methods: [{ id, name }], accounts, envKey: envKeyOf(storage.keys.source(key)) });
		}
		providers.get("anthropic")?.methods.push({ id: ANTHROPIC_API_KEY_METHOD, name: "API key" });
		return [...providers.values()];
	} finally {
		storage.close();
	}
}

/**
 * Runs `/login` entry `method` as `omp login` does, then refreshes the provider's models so `omp models` lists what the
 * credential unlocked. Answers the account it stored, `null` for an API key; throws when it stored nothing.
 */
export async function loginProvider(method: string, provider: string, hooks: LoginHooks): Promise<string | null> {
	if (method === ANTHROPIC_API_KEY_METHOD) {
		const key = (await hooks.onPrompt({ message: "Anthropic API key", secret: true })).trim();
		hooks.signal.throwIfAborted();
		if (!key || key.length > MAX_LOGIN_ANSWER || /[\r\n]/.test(key)) throw new Error("Enter a non-empty API key on one line.");
		let storage: Awaited<ReturnType<typeof auth.discoverAuthStorage>>;
		try {
			storage = await auth.discoverAuthStorage();
		} catch (cause) {
			throw new Error(KEY_NOT_SAVED, { cause });
		}
		try {
			await replaceAnthropicApiKey(storage.credentials, key, hooks.signal);
			try {
				await new modelRegistry.ModelRegistry(storage).refreshProvider("anthropic", "online");
			} catch (cause) {
				throw new Error(MODELS_NOT_REFRESHED, { cause });
			}
		} finally {
			storage.close();
		}
		return null;
	}
	const storage = await auth.discoverAuthStorage();
	try {
		const identity = await storage.oauth.login(method, { ...hooks, onBrowserSession: browserSession.captureBrowserSession });
		if (!identity) throw new Error("The sign-in ended without a credential, so omp stored nothing.");
		await new modelRegistry.ModelRegistry(storage).refreshProvider(provider, "online");
		return oauthTerminal.formatLoginIdentity(identity) ?? null;
	} finally {
		storage.close();
	}
}

/** Removes stored credential `credentialId` of `provider`, as `/logout` does; false when it was already gone. */
export async function logoutProvider(provider: string, credentialId: number): Promise<boolean> {
	const storage = await auth.discoverAuthStorage();
	try {
		const { removed } = await logout.logoutCredential(new modelRegistry.ModelRegistry(storage), provider, credentialId, "");
		return removed;
	} finally {
		storage.close();
	}
}
