import { useEffect, useState } from "react";
import type { SignInState } from "../src/shared/accounts";
import { errorText } from "../src/json";

/** How often the page asks again while a provider's sign-in page is open, to notice the sign-in soon after it ends. */
const WAITING_POLL_MS = 2_000;

/** A row's sign-in: `starting` while `connect` starts one, the provider's page while it waits on you, and why the last one failed. */
export interface SignInControls {
	starting: boolean;
	waitingUrl: string | null;
	failure: string | null;
	connect: () => Promise<void>;
}

/**
 * A provider's sign-in on the integrations page: `signIn` is the state `refresh` last read, and `connect` starts a
 * sign-in with `start`, which answers the new state, then opens the provider's page.
 */
export function useSignIn(signIn: SignInState, refresh: () => Promise<void>, start: () => Promise<SignInState>): SignInControls {
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const waitingUrl = signIn?.phase === "waiting" ? signIn.url : null;

	useEffect(() => {
		if (waitingUrl === null) return;
		const timer = setInterval(() => void refresh(), WAITING_POLL_MS);
		return () => clearInterval(timer);
	}, [refresh, waitingUrl]);

	const connect = async (): Promise<void> => {
		// Opened during the click, so the browser lets it open; it goes to the provider once the server names the address.
		// No tab (a blocked popup, or the desktop app, which denies empty windows): open the address itself instead.
		const tab = window.open("", "_blank");
		if (tab) tab.opener = null;
		setStarting(true);
		setStartError(null);
		try {
			const next = await start();
			if (next?.phase !== "waiting") tab?.close();
			else if (tab) tab.location.replace(next.url);
			else window.open(next.url, "_blank", "noopener");
			await refresh();
		} catch (err) {
			tab?.close();
			setStartError(errorText(err));
		} finally {
			setStarting(false);
		}
	};

	return { starting, waitingUrl, failure: startError ?? (signIn?.phase === "failed" ? signIn.error : null), connect };
}
