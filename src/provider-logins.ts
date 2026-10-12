/**
 * The model-provider sign-in that Settings › Providers runs: one at a time, at most five minutes, holding the page the
 * provider names and the question it waits on until the page answers it.
 */
import { errorText } from "./json";
import type { LoginHooks } from "./omp/providers";
import type { LoginPrompt, ProviderLogin } from "./shared/providers";

/** How long a sign-in may wait on you, as omp's `/mcp` sign-ins do. */
const LOGIN_MS = 5 * 60_000;

const TIMED_OUT = "The sign-in was not completed within 5 minutes. Try again.";

/** Runs `/login` entry `method` for `provider` through `hooks`; answers the account it stored, `null` for an API key. */
export type RunLogin = (method: string, provider: string, hooks: LoginHooks) => Promise<string | null>;

export interface ProviderLogins {
	/** The sign-in under way, or how the last one ended until the next starts or the page dismisses it. */
	state(): ProviderLogin | null;
	/** Starts `method` for `provider`, abandoning any sign-in under way. */
	start(provider: string, method: string): void;
	/** Answers question `promptId` of the sign-in under way; false when it no longer waits on that question. */
	answer(promptId: number, value: string): boolean;
	/** Abandons the sign-in under way, or forgets how the last one ended. */
	cancel(): void;
}

type Running = Extract<ProviderLogin, { phase: "running" }>;

/** One sign-in: what the page reads, how to stop it, and the answer its open question waits for. */
interface Attempt {
	login: ProviderLogin;
	controller: AbortController;
	pending: { prompt: LoginPrompt; answer: PromiseWithResolvers<string> } | null;
}

/** Rejects the open question and aborts the provider's flow; whatever the flow does after this, the attempt ignores. */
function stop(attempt: Attempt, reason: Error): void {
	attempt.pending?.answer.reject(reason);
	attempt.pending = null;
	attempt.controller.abort(reason);
}

/** {@link ProviderLogins} over `run`, omp's sign-in on the server and a scripted one in tests. */
export function createProviderLogins(run: RunLogin): ProviderLogins {
	let current: Attempt | null = null;
	let promptIds = 0;

	return {
		state: () => current?.login ?? null,
		start(provider, method) {
			if (current) stop(current, new Error("Another sign-in started."));
			const attempt: Attempt = {
				login: { provider, method, phase: "running", url: null, instructions: null, progress: null, prompt: null },
				controller: new AbortController(),
				pending: null,
			};
			current = attempt;
			const { signal } = attempt.controller;
			const update = (patch: Partial<Running>): void => {
				if (attempt.login.phase === "running") attempt.login = { ...attempt.login, ...patch };
			};
			const settle = (login: ProviderLogin): void => {
				if (signal.aborted) return;
				stop(attempt, new Error("The sign-in ended."));
				attempt.login = login;
			};
			const timer = setTimeout(() => settle({ provider, method, phase: "failed", error: TIMED_OUT }), LOGIN_MS);
			signal.addEventListener("abort", () => clearTimeout(timer));
			run(method, provider, {
				signal,
				onAuth: ({ url, instructions }) => update({ url, instructions: instructions ?? null }),
				onProgress: message => update({ progress: message }),
				onPrompt: ({ message, placeholder, secret, allowEmpty }) => {
					if (signal.aborted) return Promise.reject(signal.reason);
					attempt.pending?.answer.reject(new Error("The provider asked another question."));
					const prompt: LoginPrompt = { id: ++promptIds, message, placeholder: placeholder ?? null, secret: secret === true, allowEmpty: allowEmpty === true };
					const answer = Promise.withResolvers<string>();
					// A paste prompt the provider stopped awaiting, once its own callback won, rejects with no one listening.
					answer.promise.catch(() => {});
					attempt.pending = { prompt, answer };
					update({ prompt });
					return answer.promise;
				},
			}).then(
				identity => settle({ provider, method, phase: "done", identity }),
				(err: unknown) => settle({ provider, method, phase: "failed", error: errorText(err) }),
			);
		},
		answer(promptId, value) {
			const attempt = current;
			const pending = attempt?.pending;
			if (!attempt || pending?.prompt.id !== promptId) return false;
			attempt.pending = null;
			if (attempt.login.phase === "running") attempt.login = { ...attempt.login, prompt: null };
			pending.answer.resolve(value);
			return true;
		},
		cancel() {
			if (current) stop(current, new Error("Sign-in cancelled."));
			current = null;
		},
	};
}
