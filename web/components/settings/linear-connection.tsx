import { Plug } from "lucide-react";
import { useEffect, useState } from "react";
import type { LinearStatus } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { putJson } from "../../api";
import { refreshLinear, useLinear } from "../../use-linear";
import { errorText, Section } from "./editor";

/** How often the page asks again while Linear's sign-in page is open, to notice the sign-in soon after it ends. */
const WAITING_POLL_MS = 2_000;

/** Linear's connection: whether omp is signed in to Linear's MCP server, and a button that signs in. */
export function LinearConnection() {
	const { read, error } = useLinear(true);
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const status = read?.data;
	const signIn = status?.signIn ?? null;
	const waiting = signIn?.phase === "waiting";

	useEffect(() => {
		if (!waiting) return;
		const timer = setInterval(() => void refreshLinear(), WAITING_POLL_MS);
		return () => clearInterval(timer);
	}, [waiting]);

	const connect = async (): Promise<void> => {
		// Opened during the click, so the browser lets it open; it goes to Linear once the server names the address.
		// No tab (a blocked popup, or the desktop app, which denies empty windows): open the address itself instead.
		const tab = window.open("", "_blank");
		if (tab) tab.opener = null;
		setStarting(true);
		setStartError(null);
		try {
			const next = await putJson<LinearStatus>("/api/linear/sign-in", {});
			if (next.signIn?.phase !== "waiting") tab?.close();
			else if (tab) tab.location.replace(next.signIn.url);
			else window.open(next.signIn.url, "_blank", "noopener");
			await refreshLinear();
		} catch (err) {
			tab?.close();
			setStartError(errorText(err));
		} finally {
			setStarting(false);
		}
	};

	let note = <p className="text-sm text-muted-foreground">Checking whether omp is signed in to Linear…</p>;
	if (status?.connected) note = <p className="text-sm">Connected. The Tickets tab lists the Linear issues assigned to you.</p>;
	else if (status) note = <p className="text-sm text-muted-foreground">Not connected. Connect Linear to list the issues assigned to you in a Tickets tab.</p>;
	else if (error) {
		note = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot check Linear's connection: {error}
			</p>
		);
	}
	const failure = startError ?? (signIn?.phase === "failed" ? signIn.error : null);

	return (
		<Section
			title="Linear"
			meta="omp signs in to Linear's MCP server, which its sessions can use too. Saved in omp's credentials."
			actions={
				<Button variant={status?.connected ? "ghost" : "primary"} size="compact" leadingIcon={Plug} loading={starting} disabled={!status} onClick={() => void connect()}>
					{status?.connected ? "Sign in again" : "Connect Linear"}
				</Button>
			}
		>
			{note}
			{waiting && (
				<p className="text-sm text-muted-foreground">
					Waiting for you to approve omp on Linear.{" "}
					<a href={signIn.url} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
						Open Linear's sign-in page
					</a>
				</p>
			)}
			{failure && (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Sign-in failed: {failure}
				</p>
			)}
		</Section>
	);
}
