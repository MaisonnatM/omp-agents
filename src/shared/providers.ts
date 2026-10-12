/** The model providers omp's `/login` signs in to, the accounts it holds for each, and the sign-in Settings › Providers runs. */

/** One credential omp stores for a provider, as `/logout` lists it. */
export interface ProviderAccount {
	credentialId: number;
	/** The account's email, id, or project, with its organization; `API key #<id>` for a key. */
	label: string;
	/** What else tells it apart, such as `oauth #12`. */
	detail: string;
	kind: "oauth" | "api_key";
}

/** One way `/login` signs in to a provider, such as Codex's browser and device-code sign-ins. */
export interface LoginMethod {
	/** The `/login` provider id that runs it. */
	id: string;
	name: string;
}

/** A provider the credentials are filed under, with every `/login` entry that signs in to it. */
export interface ModelProvider {
	/** The provider id omp files the credentials under, which `omp models` lists models by. */
	id: string;
	name: string;
	/** Its `/login` entries; the first is the one **Connect** runs. */
	methods: LoginMethod[];
	accounts: ProviderAccount[];
	/** The environment variable omp reads the key from when nothing is stored, which Settings cannot remove. */
	envKey: string | null;
}

/** Whether omp holds a credential for `provider`, stored or from the environment. */
export const providerConnected = (provider: ModelProvider): boolean => provider.accounts.length > 0 || provider.envKey !== null;

/** A question the sign-in waits on: an API key, a pasted code or redirect address, or a choice the provider asks for. */
export interface LoginPrompt {
	/** Counts up across sign-ins, so an answer names the question it answers. */
	id: number;
	message: string;
	placeholder: string | null;
	/** The answer is a secret, so the page masks it. */
	secret: boolean;
	allowEmpty: boolean;
}

/** The sign-in that Settings › Providers last started, `method` naming the `/login` entry it runs for `provider`. */
export type ProviderLogin = { provider: string; method: string } & (
	| {
			phase: "running";
			/** The page to open, and what to do there, once the provider names it. */
			url: string | null;
			instructions: string | null;
			/** The provider's latest progress message. */
			progress: string | null;
			prompt: LoginPrompt | null;
	  }
	| { phase: "failed"; error: string }
	/** `identity` names the account the sign-in stored, `null` for an API key. */
	| { phase: "done"; identity: string | null }
);

/** `GET /api/providers`, and what the provider writes answer. */
export interface ProvidersAnswer {
	providers: ModelProvider[];
	login: ProviderLogin | null;
}

/** The longest answer a sign-in's question takes, room for a pasted redirect address. */
export const MAX_LOGIN_ANSWER = 8192;
