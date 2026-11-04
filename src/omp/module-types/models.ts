/** omp's credentials, providers, and models (pi-ai, pi-catalog, and pi-coding-agent src/config). */
import type { OmpSettingsInstance } from "./config";

/** Where a provider's credential comes from (pi-ai src/auth/types.ts `CredentialOrigin`). */
export interface CredentialOrigin {
	kind: "runtime" | "config" | "oauth" | "api_key" | "env";
	/** The variable's name when `kind` is `env` and one variable holds the key. */
	envVar?: string;
}
/** One stored credential row (pi-ai src/auth/types.ts `StoredAuthCredential`); the credential's fields stay omp's. */
export interface StoredCredential {
	id: number;
	provider: string;
	credential: { type: "oauth" | "api_key" };
}
/** What a provider's sign-in asks the page for (pi-ai src/registry/oauth/types.ts `OAuthPrompt`). */
export interface OAuthPrompt {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
	secret?: boolean;
}
/** The callbacks a provider's sign-in drives (pi-ai src/auth/types.ts `OAuthLoginController`). */
export interface OAuthLoginController {
	onAuth(info: { url: string; launchUrl?: string; instructions?: string }): void;
	onProgress(message: string): void;
	onPrompt(prompt: OAuthPrompt): Promise<string>;
	onBrowserSession?(request: unknown, signal?: AbortSignal): Promise<string>;
	signal: AbortSignal;
}
/** The account a sign-in stored (pi-ai src/auth/types.ts `OAuthLoginIdentity`). */
export interface OAuthLoginIdentity {
	type: "oauth" | "api_key";
}
/** Subset of omp's `AuthStorage` (pi-ai src/auth-storage.ts) this app reads and writes. */
export interface AuthStorage {
	/** Where `provider`'s credential comes from (a login, a stored key, an environment variable), `undefined` with none. */
	keys: { source(provider: string): CredentialOrigin | undefined };
	/** The stored credential rows, by provider id; an MCP server's sign-in is filed under its credential id. */
	credentials: {
		hasOAuth(provider: string): boolean;
		list(provider: string): StoredCredential[];
		set(provider: string, credential: Record<string, unknown> & { type: "oauth" }): Promise<void>;
	};
	/** Runs `provider`'s `/login` flow and stores what it returns; `undefined` when it stored nothing. */
	oauth: { login(provider: string, controller: OAuthLoginController): Promise<OAuthLoginIdentity | undefined> };
	close(): void;
}
export interface AuthModule {
	/** omp's credential store, through its auth broker when one is configured. */
	discoverAuthStorage(): Promise<AuthStorage>;
}
export interface OAuthModule {
	/** Every provider omp's `/login` offers; `storeCredentialsAs` names the provider its credential is filed under when that differs from `id`. */
	getOAuthProviders(): { id: string; name: string; available: boolean; storeCredentialsAs?: string }[];
}
/** The fields of omp's `Model` (pi-ai src/types.ts) the dashboard reads; the rest rides through to omp. */
export interface OmpModel {
	provider: string;
	id: string;
}
/** omp's model registry (src/config/model-registry.ts), built over a credential store. */
export interface ModelRegistryModule {
	ModelRegistry: new (storage: AuthStorage) => {
		refreshProvider(provider: string, strategy: "online"): Promise<void>;
		/** Loads the models, fetching a provider's catalog only when none is cached. */
		refresh(): Promise<void>;
		/** The chat models of the providers you can call. */
		getAvailable(): OmpModel[];
	};
}
/** What `/logout` shows and removes (src/slash-commands/helpers/logout.ts). */
export interface LogoutModule {
	toLogoutAccounts(provider: string, credentials: StoredCredential[]): { credentialId: number; label: string; detail: string; type: "oauth" | "api_key" }[];
	/** Removes credential row `credentialId` of `loginProvider` and refreshes its models; `removed` is false when it was already gone. */
	logoutCredential(registry: InstanceType<ModelRegistryModule["ModelRegistry"]>, loginProvider: string, credentialId: number, sessionId: string): Promise<{ removed: boolean }>;
}
export interface OAuthTerminalModule {
	/** `email (org)`, `email`, or `org` for an OAuth sign-in; `undefined` for an API key or a sign-in that named no account. */
	formatLoginIdentity(identity: OAuthLoginIdentity | undefined): string | undefined;
}
export interface BrowserSessionModule {
	/** Opens an isolated Chromium for a sign-in that reads a cookie, as `/login` does for Perplexity. */
	captureBrowserSession(request: unknown, signal?: AbortSignal): Promise<string>;
}
/** The fields of omp's `Model` (pi-ai src/types.ts) that decide its service tiers. */
export interface ServiceTierModel {
	provider: string;
	api: string;
	identity: { class: string };
	serviceTiers?: string[];
}
export interface ServiceTierModule {
	/** The family whose service-tier knob governs `model`, `undefined` when it has none. */
	serviceTierFamily(model: ServiceTierModel): string | undefined;
	/** Whether omp sends `tier` to `model`'s provider. */
	shouldSendServiceTier(tier: string, model: ServiceTierModel): boolean;
}
export interface FallbackChainsModule {
	/** Gives every chat role without a chain of its own the `default` chain. */
	expandDefaultRetryFallbackChains(configured: Record<string, string[]>, roleNames: readonly string[]): Record<string, string[]>;
	/** omp's reading of a selector: `provider/id`, then an optional `:level` once `find` knows the id without it. */
	parseRetryFallbackSelector(
		selector: string,
		lookup: { find(provider: string, id: string): unknown },
	): { provider: string; id: string; thinkingLevel: string | undefined } | undefined;
}
export interface ModelResolverModule {
	/** The listed model that omp runs for `provider/id`, following retired variant ids such as `grok-4.7-high` and dotted revision spellings. */
	resolveProviderModelReference<M extends { provider: string; id: string }>(provider: string, modelId: string, models: readonly M[]): M | undefined;
	/** `role`'s model and its retry fallbacks among `pool`, in the order omp tries them. */
	resolveRoleChain<M extends OmpModel>(role: string, settings: OmpSettingsInstance, pool: M[]): { model: M }[];
	resolveAgentModelSelection(options: { settingsOverride?: string | string[]; agentModel?: string[]; settings: OmpSettingsInstance; activeModelPattern?: string }): { patterns: string[]; role: string | undefined };
	resolveModelOverride(patterns: string[], registry: { getAvailable(): OmpModel[] }, settings: OmpSettingsInstance): { model?: OmpModel; thinkingLevel?: string; warning?: string };
}
/** pi-catalog's model identity (src/identity): the vendor lineage, product family, and `major.minor.patch` revision an id names. */
export interface ModelIdentityModule {
	classifyModel(provider: string, modelId: string, options: { lenient: true }): { class: string; family?: string; revision?: string };
}
/** pi-catalog's `Model` (src/types.ts), opaque here: what `calculateCost` prices with. */
export interface CatalogModel {
	cost: object;
}
/** The fields of pi-catalog's `Usage` (src/types.ts) that `calculateCost` reads; it writes the prices into `cost`. */
export interface CatalogUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	/** Anthropic's cache writes by lifetime, each billed at its own rate. */
	cttl?: { ephemeral5m: number; ephemeral1h: number };
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}
/** pi-catalog's bundled models (src/models.ts), with the list prices omp records on its own requests. */
export interface CatalogModule {
	/** `undefined` for a provider or model the bundle does not list. */
	getBundledModel(provider: string, modelId: string): CatalogModel | undefined;
	/** Prices `usage` at `timestamp` (ms), with the rate card and long-context tier in force then. */
	calculateCost(model: CatalogModel, usage: CatalogUsage, timestamp: number): CatalogUsage["cost"];
}
