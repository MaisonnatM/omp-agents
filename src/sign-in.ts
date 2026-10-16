/**
 * The sign-ins Settings › Integrations and Settings › MCP servers start to omp's MCP servers: one at a time each,
 * waiting for the browser at most five minutes, and holding the status of what it signs in to while one waits.
 */
import { errorText } from "./json";
import type { SignInState } from "./shared/accounts";
import type { McpRemoteStatus } from "./shared/mcp-status";

/** How long a sign-in waits for the browser, as omp's `/mcp` does. */
const SIGN_IN_MS = 5 * 60_000;

/** A sign-in under way or that last failed, and the `Target` it signs in to. */
export interface SignInAttempt<Target> {
	/** `null` until the sign-in has the provider's authorization address. */
	signIn: SignInState;
	target: Target;
}

/** The sign-ins to one server, or to one service's accounts, `Target` naming which a sign-in is to. */
export interface SignIn<Target = null> {
	/** The sign-in under way or that last failed, `null` once one succeeds. */
	state(): SignInAttempt<Target> | null;
	/** Abandons the sign-in under way, whose `signal` aborts, and forgets one that failed. */
	cancel(): void;
	/**
	 * Runs `run` to sign in to `target`, abandoning any sign-in under way, and resolves once `run` calls `waiting` with
	 * the provider's authorization address, or ends. `signal` aborts when another sign-in replaces this one or the time runs out.
	 */
	start(target: Target, run: (signal: AbortSignal, waiting: (url: string) => void) => Promise<void>): Promise<void>;
	/**
	 * `target`'s status as `read` answers it, or while a sign-in to `target` waits on the browser, as `read` last answered
	 * it during that sign-in: the sign-in is about to change it, and the page asks every few seconds meanwhile.
	 */
	hold(target: Target, read: () => Promise<McpRemoteStatus>): Promise<McpRemoteStatus>;
}

/** A {@link SignIn}; `timeoutError` is the failure a sign-in shows when the browser does not come back in time. */
export function createSignIn<Target = null>(timeoutError: string): SignIn<Target> {
	let current: (SignInAttempt<Target> & { controller: AbortController; held: McpRemoteStatus | null }) | null = null;
	return {
		state: () => current && { signIn: current.signIn, target: current.target },
		cancel(): void {
			current?.controller.abort();
			current = null;
		},
		async start(target, run) {
			current?.controller.abort();
			const attempt: NonNullable<typeof current> = { signIn: null, target, controller: new AbortController(), held: null };
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
		async hold(target, read) {
			const attempt = current;
			if (attempt?.target !== target) return read();
			if (attempt.signIn?.phase === "waiting" && attempt.held) return attempt.held;
			attempt.held = await read();
			return attempt.held;
		},
	};
}
