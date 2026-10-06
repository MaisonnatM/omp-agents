/** The sign-ins the integrations page starts, to omp's MCP servers and to Google: one at a time each, waiting for the browser at most five minutes. */
import { errorText } from "./json";
import type { SignInState } from "./shared/accounts";

/** How long a sign-in waits for the browser, as omp's `/mcp` does. */
const SIGN_IN_MS = 5 * 60_000;

/** One provider's sign-in under way or that last failed. */
export interface SignIn {
	/** The sign-in under way or that last failed, `null` once one succeeds. */
	state(): SignInState;
	/** Abandons the sign-in under way, whose `signal` aborts, and forgets one that failed. */
	cancel(): void;
	/**
	 * Runs `run`, abandoning any sign-in under way, and resolves once `run` calls `waiting` with the provider's
	 * authorization address, or ends. `signal` aborts when another sign-in replaces this one or the time runs out.
	 */
	start(run: (signal: AbortSignal, waiting: (url: string) => void) => Promise<void>): Promise<void>;
}

/** A provider's {@link SignIn}; `timeoutError` is the failure a sign-in shows when the browser does not come back in time. */
export function createSignIn(timeoutError: string): SignIn {
	let current: { signIn: SignInState; controller: AbortController } | null = null;
	return {
		state: () => current?.signIn ?? null,
		cancel(): void {
			current?.controller.abort();
			current = null;
		},
		async start(run) {
			current?.controller.abort();
			const attempt: NonNullable<typeof current> = { signIn: null, controller: new AbortController() };
			current = attempt;
			const timeout = AbortSignal.timeout(SIGN_IN_MS);
			const ready = Promise.withResolvers<void>();
			const waiting = (url: string): void => {
				attempt.signIn = { phase: "waiting", url };
				ready.resolve();
			};
			run(AbortSignal.any([attempt.controller.signal, timeout]), waiting)
				.then(
					() => {
						if (current === attempt) current = null;
					},
					(err: unknown) => {
						if (!attempt.controller.signal.aborted) attempt.signIn = { phase: "failed", error: timeout.aborted ? timeoutError : errorText(err) };
					},
				)
				.finally(() => ready.resolve());
			await ready.promise;
		},
	};
}
