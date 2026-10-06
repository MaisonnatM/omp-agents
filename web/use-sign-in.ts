import { useEffect, useState } from "react";
import type { SignInState } from "../src/shared/accounts";
import { errorText, putJson } from "./api";
import type { PolledEntry } from "./polled-store";

/** How often the settings ask again while a provider's sign-in page is open, to notice the sign-in soon after it ends. */
const WAITING_POLL_MS = 2_000;

interface SignInStore<T> {
	usePolling: () => PolledEntry<T>;
	refresh: () => Promise<void>;
}

/** A provider's connection in the settings, read from `store`, and `connect`, which starts a sign-in at `url` and opens the provider's page. */
export function useSignIn<T extends { signIn: SignInState }>(store: SignInStore<T>, url: string) {
	const { read, error } = store.usePolling();
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const status = read?.data ?? null;
	const signIn = status?.signIn ?? null;
	const waitingUrl = signIn?.phase === "waiting" ? signIn.url : null;

	useEffect(() => {
		if (waitingUrl === null) return;
		const timer = setInterval(() => void store.refresh(), WAITING_POLL_MS);
		return () => clearInterval(timer);
	}, [store, waitingUrl]);

	const connect = async (): Promise<void> => {
		// Opened during the click, so the browser lets it open; it goes to the provider once the server names the address.
		// No tab (a blocked popup, or the desktop app, which denies empty windows): open the address itself instead.
		const tab = window.open("", "_blank");
		if (tab) tab.opener = null;
		setStarting(true);
		setStartError(null);
		try {
			const next = await putJson<T>(url, {});
			if (next.signIn?.phase !== "waiting") tab?.close();
			else if (tab) tab.location.replace(next.signIn.url);
			else window.open(next.signIn.url, "_blank", "noopener");
			await store.refresh();
		} catch (err) {
			tab?.close();
			setStartError(errorText(err));
		} finally {
			setStarting(false);
		}
	};

	return { status, error, starting, waitingUrl, failure: startError ?? (signIn?.phase === "failed" ? signIn.error : null), connect };
}
