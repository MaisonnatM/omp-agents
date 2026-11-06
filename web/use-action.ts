import { useState, useSyncExternalStore } from "react";
import { errorText } from "../src/json";
import { toasts } from "./components/toaster";

/** Where a control's work stands: running with the arguments it got, or failed with them until the next run or a dismiss. */
export type ActionState<A extends unknown[]> = { kind: "idle" } | { kind: "pending"; args: A } | { kind: "failed"; args: A; error: string };

/** A control's server work, and where it stands. */
export interface Action<A extends unknown[]> {
	/** Runs the work, unless it is already running. */
	run: (...args: A) => void;
	state: ActionState<A>;
	/** The work is running: its control shows so and takes no second press. */
	pending: boolean;
	/** Why the last run failed, until the next run or `dismiss`. */
	error: string | null;
	/** Forgets the last failure. */
	dismiss: () => void;
}

const IDLE = { kind: "idle" } as const;

/**
 * One control's work and its state, outside React so a second press in the same frame sees the first one pending.
 * A failure toasts `failureTitle` with its message while a component shows the action; a null title leaves the failure to the caller.
 */
export class ActionRunner<A extends unknown[]> {
	state: ActionState<A> = IDLE;
	readonly #listeners = new Set<() => void>();

	constructor(
		public work: (...args: A) => Promise<void>,
		public failureTitle: string | null,
	) {}

	readonly subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	readonly read = (): ActionState<A> => this.state;

	readonly run = (...args: A): void => {
		if (this.state.kind === "pending") return;
		this.#set({ kind: "pending", args });
		// The async wrapper turns a synchronous throw into a rejection, so the action never stays pending.
		(async () => this.work(...args))().then(
			() => this.#set(IDLE),
			(error: unknown) => {
				const text = errorText(error);
				this.#set({ kind: "failed", args, error: text });
				if (this.failureTitle !== null && this.#listeners.size > 0) toasts.add({ title: this.failureTitle, description: text });
			},
		);
	};

	readonly dismiss = (): void => {
		if (this.state.kind === "failed") this.#set(IDLE);
	};

	#set(state: ActionState<A>): void {
		this.state = state;
		for (const listener of this.#listeners) listener();
	}
}

/**
 * Runs `work` for a control, pending until it settles. A rejection toasts `failureTitle` with its message, or, when the
 * title is null, stays in `error` for the control to show beside itself. The work outlives the component, but what it
 * settles to after unmount shows nowhere.
 */
export function useAction<A extends unknown[]>(work: (...args: A) => Promise<void>, failureTitle: string | null): Action<A> {
	const [runner] = useState(() => new ActionRunner(work, failureTitle));
	runner.work = work;
	runner.failureTitle = failureTitle;
	const state = useSyncExternalStore(runner.subscribe, runner.read, runner.read);
	return { run: runner.run, state, pending: state.kind === "pending", error: state.kind === "failed" ? state.error : null, dismiss: runner.dismiss };
}
