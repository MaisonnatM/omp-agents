import { useRef, useState } from "react";
import { errorText } from "./api";

interface QueuedSaveOptions<T> {
	/** Shows `answer` in place of the last read. */
	replace: (answer: T) => void;
	/** Reads the item again. */
	reload: () => void;
	/** A save answered. */
	onSaved?: () => void;
}

/**
 * Field edits that show at once and are sent in turn: `save(shown, send)` shows `shown`, then calls `send` once every
 * save before it has answered, and shows what it answers. When the service refuses one, `error` says why, and the item
 * is read again once every save sent has answered.
 */
export function useQueuedSave<T>({ replace, reload, onSaved }: QueuedSaveOptions<T>): { save: (shown: T, send: () => Promise<T>) => void; error: string | null } {
	const [error, setError] = useState<string | null>(null);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const unsent = useRef(0);
	const refused = useRef(false);
	const save = (shown: T, send: () => Promise<T>): void => {
		replace(shown);
		setError(null);
		unsent.current++;
		queue.current = queue.current.then(() =>
			send()
				.then(
					after => {
						replace(after);
						onSaved?.();
					},
					(err: unknown) => {
						setError(errorText(err));
						refused.current = true;
					},
				)
				.then(() => {
					if (--unsent.current > 0 || !refused.current) return;
					refused.current = false;
					reload();
				}),
		);
	};
	return { save, error };
}
