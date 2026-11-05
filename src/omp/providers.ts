/**
 * omp's model-provider sign-ins, as `omp login` and `/logout` run them: the `/login` providers grouped by the provider their
 * credentials are filed under, the sign-in itself, and removing one stored credential. The credential store opens and
 * closes on each call, so a sign-in from a terminal shows at the next read.
 */
import { addApiCreditsProvider, removeApiCreditsProvider, replaceAnthropicApiKey, settleApiCredits } from "./api-credits";
import { dropModelList } from "./models";
import type { AuthStorage, CredentialOrigin, OAuthLoginController } from "./module-types/models";
import { auth, browserSession, logout, modelRegistry, oauth, oauthTerminal } from "./modules";
import { API_CREDITS_PROVIDER, PROVIDER_NAMES } from "../shared/models";
import { ANTHROPIC_API_KEY_METHOD, MAX_LOGIN_ANSWER, type ModelProvider } from "../shared/providers";

/** The callbacks a sign-in reports through; omp adds the isolated browser that a cookie sign-in opens. */
export type LoginHooks = Omit<OAuthLoginController, "onBrowserSession">;

const KEY_NOT_SAVED = "The API key could not be saved. Check that omp's credential store is available.";
const MODELS_NOT_REFRESHED = "The API key was saved, but models could not refresh. Refresh Providers before trying again.";

export { replaceAnthropicApiKey };

/** The Anthropic catalog ids a custom `anthropic-api` entry copies, so its models keep omp's limits and prices. */
async function anthropicModelIds(storage: AuthStorage): Promise<string[]> {
	const registry = new modelRegistry.ModelRegistry(storage);
	await registry.refresh();
	return registry.getAll().flatMap(model => (model.provider === "anthropic" ? [model.id] : []));
}

/** Settings' API credits row: the Anthropic Console key that `anthropic-api` models bill. */
function apiCreditsRow(storage: AuthStorage): ModelProvider {
	const accounts = logout.toLogoutAccounts(API_CREDITS_PROVIDER, storage.credentials.list(API_CREDITS_PROVIDER)).map(({ credentialId, label, detail, type }) => ({ credentialId, label, detail, kind: type }));
	return { id: API_CREDITS_PROVIDER, name: `Anthropic ${PROVIDER_NAMES[API_CREDITS_PROVIDER]}`, methods: [{ id: ANTHROPIC_API_KEY_METHOD, name: "API key" }], accounts, envKey: null };
}

/** The environment variable omp reads `provider`'s key from, when no stored credential takes precedence over it. */
const envKeyOf = (origin: CredentialOrigin | undefined): string | null => (origin?.kind === "env" ? (origin.envVar ?? "an environment variable") : null);

/** Every available `/login` entry, grouped by the provider its credentials are filed under, in omp's order. */
export async function listProviders(): Promise<ModelProvider[]> {
	const storage = await auth.discoverAuthStorage();
	try {
		if (await settleApiCredits(storage.credentials, () => anthropicModelIds(storage))) dropModelList();
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
		const rows = [...providers.values()];
		rows.splice(rows.findIndex(({ id }) => id === "anthropic") + 1, 0, apiCreditsRow(storage));
		return rows;
	} finally {
		storage.close();
	}
}

/**
 * Runs `/login` entry `method` as `omp login` does, then refreshes the provider's models so `omp models` lists what the
 * credential unlocked. An Anthropic API key also adds the API credits provider to `models.yml`, listing the models of
 * omp's Anthropic catalog. Answers the account it stored, `null` for an API key; throws when it stored nothing.
 */
export async function loginProvider(method: string, provider: string, hooks: LoginHooks): Promise<string | null> {
	if (method === ANTHROPIC_API_KEY_METHOD) {
		const key = (await hooks.onPrompt({ message: "Anthropic API key", secret: true })).trim();
		hooks.signal.throwIfAborted();
		if (!key || key.length > MAX_LOGIN_ANSWER || /[\r\n]/.test(key)) throw new Error("Enter a non-empty API key on one line.");
		let storage: AuthStorage;
		try {
			storage = await auth.discoverAuthStorage();
		} catch (cause) {
			throw new Error(KEY_NOT_SAVED, { cause });
		}
		try {
			await replaceAnthropicApiKey(storage.credentials, key, hooks.signal);
			try {
				await addApiCreditsProvider(await anthropicModelIds(storage));
				dropModelList();
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

/**
 * Removes stored credential `credentialId` of `provider`, as `/logout` does; false when it was already gone. Removing the
 * last API credits key also removes that provider from `models.yml`.
 */
export async function logoutProvider(provider: string, credentialId: number): Promise<boolean> {
	const storage = await auth.discoverAuthStorage();
	try {
		const { removed } = await logout.logoutCredential(new modelRegistry.ModelRegistry(storage), provider, credentialId, "");
		if (provider === API_CREDITS_PROVIDER && storage.credentials.list(API_CREDITS_PROVIDER).length === 0) {
			await removeApiCreditsProvider();
			dropModelList();
		}
		return removed;
	} finally {
		storage.close();
	}
}
