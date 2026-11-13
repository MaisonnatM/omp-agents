/** Asks for a new shell in the terminal panel from elsewhere on the page, as the details sidebar's **New terminal** does. */

const listeners = new Set<() => void>();

/** Opens the terminal panel on a new shell. */
export function requestNewTerminal(): void {
	for (const listener of listeners) listener();
}

/** Calls `listener` after each {@link requestNewTerminal}, until the returned function stops it. */
export function onNewTerminalRequest(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
