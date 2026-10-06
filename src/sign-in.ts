/** The sign-ins the settings start, to Linear and to Google: one at a time each, waiting for the browser at most five minutes. */
import { errorText } from "./json";
import type { SignInState } from "./shared/accounts";

/** How long a sign-in waits for the browser, as omp's `/mcp` does. */
const SIGN_IN_MS = 5 * 60_000;

/**
 * One provider's sign-in under way or that last failed, `null` once one succeeds. `timeoutError` is the failure a
 * sign-in shows when the browser does not come back in time.
 */
export function createSignIn(timeoutError: string) {
	let current: { signIn: SignInState; controller: AbortController } | null = null;
	return {
		state: (): SignInState => current?.signIn ?? null,
		/** Abandons the sign-in under way, whose `signal` aborts, and forgets one that failed. */
		cancel(): void {
			current?.controller.abort();
			current = null;
		},
		/**
		 * Runs `run`, abandoning any sign-in under way, and resolves once `run` calls `waiting` with the provider's
		 * authorization address, or ends. `signal` aborts when another sign-in replaces this one or the time runs out.
		 */
		async start(run: (signal: AbortSignal, waiting: (url: string) => void) => Promise<void>): Promise<void> {
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
