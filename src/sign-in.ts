/**
 * The sign-ins Settings › Integrations and Settings › MCP servers start to omp's MCP servers: one at a time each,
 * waiting for the browser at most five minutes, and holding the server's status while one waits.
 */
import { errorText } from "./json";
import type { SignInState } from "./shared/accounts";
import type { McpRemoteStatus } from "./shared/mcp-status";

/** How long a sign-in waits for the browser, as omp's `/mcp` does. */
const SIGN_IN_MS = 5 * 60_000;

/** What a sign-in runs: it calls `waiting` with the provider's authorization address, and stops once `signal` aborts. */
type Run = (signal: AbortSignal, waiting: (url: string) => void) => Promise<void>;

/** The sign-ins to one server. */
export interface SignIn {
	/** The sign-in under way or that last failed, `null` once one succeeds. */
	state(): SignInState;
	/** Abandons the sign-in under way, whose `signal` aborts, and forgets one that failed. */
	cancel(): void;
	/**
	 * Runs `run`, abandoning any sign-in under way, and resolves once `run` calls `waiting` with the provider's
	 * authorization address, or ends. `signal` aborts when another sign-in replaces this one or the time runs out.
	 */
	start(run: Run): Promise<void>;
	/**
	 * The server's status as `read` answers it, or while a sign-in waits on the browser, as `read` last answered it
	 * during that sign-in: the sign-in is about to change it, and the page asks every few seconds meanwhile.
	 */
	hold(read: () => Promise<McpRemoteStatus>): Promise<McpRemoteStatus>;
}

/** A {@link SignIn}; `timeoutError` is the failure a sign-in shows when the browser does not come back in time. */
export function createSignIn(timeoutError: string): SignIn {
	let current: { signIn: SignInState; controller: AbortController; held: McpRemoteStatus | null } | null = null;
	return {
		state: () => current?.signIn ?? null,
		cancel(): void {
			current?.controller.abort();
			current = null;
		},
		async start(run) {
			current?.controller.abort();
			const attempt: NonNullable<typeof current> = { signIn: null, controller: new AbortController(), held: null };
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
		async hold(read) {
			const attempt = current;
			if (!attempt) return read();
			if (attempt.signIn?.phase === "waiting" && attempt.held) return attempt.held;
			attempt.held = await read();
			return attempt.held;
		},
	};
}
