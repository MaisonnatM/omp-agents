import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./api";
import { toasts } from "./components/toaster";

/** A control's server work, and whether it is running. */
export interface Action<A extends unknown[]> {
	/** Runs the work, unless it is already running; a failure shows as a toast. */
	run: (...args: A) => void;
	/** The work is running: its control shows so and takes no second press. */
	pending: boolean;
}

/**
 * Runs `work` for a control, pending until it settles; a rejection toasts `failureTitle` with its message. The work
 * outlives the component, but what it settles to after unmount shows nowhere.
 */
export function useAction<A extends unknown[]>(work: (...args: A) => Promise<void>, failureTitle: string): Action<A> {
	const [pending, setPending] = useState(false);
	const latest = useRef({ work, failureTitle });
	latest.current = { work, failureTitle };
	const running = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const run = useCallback((...args: A) => {
		if (running.current) return;
		running.current = true;
		setPending(true);
		latest.current.work(...args).then(
			() => {
				running.current = false;
				if (mounted.current) setPending(false);
			},
			(error: unknown) => {
				running.current = false;
				if (!mounted.current) return;
				setPending(false);
				toasts.add({ title: latest.current.failureTitle, description: errorText(error) });
			},
		);
	}, []);
	return { run, pending };
}
