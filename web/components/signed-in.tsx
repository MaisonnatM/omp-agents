/** What the page shows instead of the dashboard while it holds no token the server takes. */
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { isSignedOut, onSignOut } from "../api";

function SignedOut() {
	// The desktop app holds the token, so it signs its window in again; a browser needs the printed address.
	useEffect(() => window.ompDesktop?.signIn?.(), []);
	return (
		<main className="mx-auto mt-16 max-w-lg px-4 text-sm">
			<h1 className="mb-2 text-lg font-semibold">Not signed in</h1>
			<p className="text-muted-foreground">
				Open the address that the omp-agents server printed in its terminal when it started. It ends in <code>/?token=…</code>, and signs this browser in.
				The token is also in <code>~/.config/omp-agents/token</code>.
			</p>
		</main>
	);
}

/** `children` while the page is signed in, else the sign-in instructions; a 401 from the server switches over at once. */
export function SignedIn({ children }: { children: ReactNode }) {
	return useSyncExternalStore(onSignOut, isSignedOut) ? <SignedOut /> : children;
}
