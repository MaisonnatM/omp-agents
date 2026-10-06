import { Plug } from "lucide-react";
import type { LinearStatus } from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { linearStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { Section } from "./editor";

/** Linear's connection: whether omp is signed in to Linear's MCP server, and a button that signs in. */
export function LinearConnection() {
	const { status, error, starting, waitingUrl, failure, connect } = useSignIn<LinearStatus>(linearStore, "/api/linear/sign-in");

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
			{waitingUrl && (
				<p className="text-sm text-muted-foreground">
					Waiting for you to approve omp on Linear.{" "}
					<a href={waitingUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
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
