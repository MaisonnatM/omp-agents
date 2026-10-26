/** What the page shows instead of the dashboard while it holds no token the server takes. */
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { isSignedOut, onSignOut } from "../api";

function SignedOut() {
	// The desktop app loads the page again when its token file holds a token the page has not tried.
	useEffect(() => window.ompDesktop?.signIn?.(), []);
	return (
		<main className="mx-auto mt-16 max-w-lg px-4 text-sm">
			{window.ompDesktop ? (
				<>
					<h1 className="mb-2 text-lg font-semibold">The server holds another token</h1>
					<p className="text-muted-foreground">The omp-agents server on this port started before its token file changed. Restart that server, then reopen the app.</p>
				</>
			) : (
				<>
					<h1 className="mb-2 text-lg font-semibold">Open the omp agents app</h1>
					<p className="text-muted-foreground">The dashboard runs in the omp agents desktop app. A browser tab cannot sign in to it.</p>
				</>
			)}
		</main>
	);
}

/** `children` while the page is signed in, else the notice that sends you to the desktop app; a 401 from the server switches over at once. */
export function SignedIn({ children }: { children: ReactNode }) {
	return useSyncExternalStore(onSignOut, isSignedOut) ? <SignedOut /> : children;
}
