/**
 * omp's model-provider sign-ins, as `omp login` and `/logout` run them: the `/login` providers grouped by the provider their
 * credentials are filed under, the sign-in itself, and removing one stored credential. The credential store opens and
 * closes on each call, so a sign-in from a terminal shows at the next read.
 */
import type { CredentialOrigin, OAuthLoginController } from "./modules";
import { auth, browserSession, logout, modelRegistry, oauth, oauthTerminal } from "./modules";
import type { ModelProvider } from "../shared/providers";

/** The callbacks a sign-in reports through; omp adds the isolated browser that a cookie sign-in opens. */
export type LoginHooks = Omit<OAuthLoginController, "onBrowserSession">;

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
