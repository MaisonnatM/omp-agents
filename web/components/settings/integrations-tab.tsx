import { RefreshCw } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { anyCallable, callable, connectionsOf, type IntegrationsAnswer, MCP_INTEGRATIONS, signedIn } from "../../../src/shared/accounts";
import type { GoogleStatus } from "../../../src/shared/calendar";
import type { Workspace } from "../../../src/shared/workspaces";
import { readTime } from "../../labels";
import type { PolledEntry } from "../../polled-store";
import { googleStore, integrationsStore } from "../../reads";
import { GoogleCalendarList, GoogleCalendarsError } from "../integrations/google-calendar";
import { IntegrationList } from "../integrations/integration-row";
import { McpIntegrationRow } from "../integrations/mcp-integration";
import { LoadNote } from "../sheet-details";
import { Section } from "./editor";

interface Entry {
	key: string;
	connected: boolean;
	row: ReactNode;
}

/** A titled list of rows, absent while it has none. */
function Group({ title, entries }: { title: string; entries: Entry[] }) {
	if (entries.length === 0) return null;
	return (
		<section className="space-y-2.5">
			<h4 className="flex items-baseline gap-2 px-1 text-[13px] font-medium">
				{title}
				<span className="text-muted-foreground tabular-nums">{entries.length}</span>
			</h4>
			<IntegrationList label={title}>
				{entries.map(entry => (
					<Fragment key={entry.key}>{entry.row}</Fragment>
				))}
			</IntegrationList>
		</section>
	);
}

/** The integrations a sign-in holds, then the rest, then where their credentials live. */
function Groups({ answer, google, workspaces }: { answer: IntegrationsAnswer; google: PolledEntry<GoogleStatus>; workspaces: Workspace[] }) {
	const entries: Entry[] = MCP_INTEGRATIONS.map(id => answer.integrations[id]).map(integration => ({
		key: integration.id,
		connected: connectionsOf(integration).some(signedIn),
		row: (
			<McpIntegrationRow
				integration={integration}
				workspaces={workspaces}
				notice={integration.id === "google-calendar" && <GoogleCalendarsError entry={google} />}
				details={account => integration.id === "google-calendar" && callable(account.connection) && <GoogleCalendarList entry={google} account={account.name} />}
			/>
		),
	}));
	return (
		<div className="space-y-8">
			<Group title="Connected" entries={entries.filter(entry => entry.connected)} />
			<Group title="Available" entries={entries.filter(entry => !entry.connected)} />
			<p className="px-1 text-xs text-pretty text-muted-foreground">
				omp keeps its MCP sign-ins in its own credential store, so every omp session can use them. The Calendar page reads Google Calendar, and the Inbox page reads Gmail, with omp's
				sign-in to each account. A Google account linked to workspaces shows on those pages only while the sidebar picks one of them, and sessions in them are told to use it.
			</p>
		</div>
	);
}

/** The services omp connects to through its MCP servers, each checked by listing its tools, with the calendars each Google Calendar account reads, and the workspaces a Google account may be linked to. */
export function IntegrationsTab({ active, workspaces }: { active: boolean; workspaces: Workspace[] }) {
	const poll = integrationsStore.usePolling(null, active);
	const calendarAccounts = poll.read?.data.integrations["google-calendar"].accounts;
	const google = googleStore.usePolling(null, active && calendarAccounts !== undefined && anyCallable(calendarAccounts));
	const { read, error, refreshing } = poll;
	const meta = "Services omp and this dashboard connect to";
	return (
		<Section
			title="Integrations"
			meta={read ? `${meta} · updated ${readTime(read.at)}` : meta}
			actions={
				<Button
					variant="ghost"
					size="compact"
					leadingIcon={RefreshCw}
					disabled={refreshing}
					onClick={() => {
						void integrationsStore.refresh(null, { fresh: true });
						void googleStore.refresh(null, { fresh: true });
					}}
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>
			}
		>
			{read ? (
				<>
					{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the integrations: {error}</p>}
					<Groups answer={read.data} google={google} workspaces={workspaces} />
				</>
			) : (
				<LoadNote loading="Checking omp's MCP servers…" error={error && `Cannot load the integrations: ${error}`} />
			)}
		</Section>
	);
}
