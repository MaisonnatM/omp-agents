/** The home's empty state, when no session or page shows. */
import { CircleAlert, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SPLIT_CLICK } from "../labels";
import { useDashboardActions } from "./dashboard-context";
import { Callout } from "./integrations/integration-row";

/** The main area when no session or page shows. */
export function EmptyHome({ live, rosterError }: { live: boolean; rosterError: string | null }) {
	const { openNewSession } = useDashboardActions();
	return (
		<Empty className="m-auto max-w-lg flex-none">
			<EmptyHeader>
				<EmptyTitle>{live ? "Select a session" : "No sessions are running"}</EmptyTitle>
				<EmptyDescription>{live ? `Choose a session to see its conversation. ${SPLIT_CLICK} more to see up to four side by side.` : "Start a session here, or return to setup whenever you need it."}</EmptyDescription>
			</EmptyHeader>
			<div className="flex flex-wrap justify-center gap-2">
				<Button size="compact" leadingIcon={Plus} onClick={() => openNewSession()}>
					New session
				</Button>
				<Button variant="secondary" size="compact" render={<a href="#get-started" />}>
					Get started
				</Button>
			</div>
			{rosterError && (
				<Callout tone="warning" icon={CircleAlert}>
					Registry error: {rosterError}
				</Callout>
			)}
		</Empty>
	);
}
