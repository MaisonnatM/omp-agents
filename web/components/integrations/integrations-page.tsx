import { Fragment, type ReactNode } from "react";
import { type GoogleStatus, type IntegrationsAnswer, MCP_INTEGRATIONS, signedIn } from "../../../src/shared/accounts";
import type { PolledEntry } from "../../polled-store";
import { googleStore, integrationsStore } from "../../reads";
import { ListPage } from "../list-page";
import { GoogleCalendarRow } from "./google-calendar";
import { IntegrationList } from "./integration-row";
import { McpIntegrationRow } from "./mcp-integration";

interface Entry {
	key: string;
	connected: boolean;
	row: ReactNode;
}

/** A titled list of rows, absent while it has none. */
function Section({ title, entries }: { title: string; entries: Entry[] }) {
	if (entries.length === 0) return null;
	return (
		<section className="space-y-2.5">
			<h2 className="flex items-baseline gap-2 px-1 text-[13px] font-medium">
				{title}
				<span className="text-muted-foreground tabular-nums">{entries.length}</span>
			</h2>
			<IntegrationList label={title}>
				{entries.map(entry => (
					<Fragment key={entry.key}>{entry.row}</Fragment>
				))}
			</IntegrationList>
		</section>
	);
}

/** The integrations a sign-in holds, then the rest, then where their credentials live. */
function Sections({ answer, google }: { answer: IntegrationsAnswer; google: PolledEntry<GoogleStatus> }) {
	const entries: Entry[] = MCP_INTEGRATIONS.map(id => answer.integrations[id]).map(integration => ({
		key: integration.id,
		connected: signedIn(integration.connection),
		row: <McpIntegrationRow integration={integration} />,
	}));
	const googleStatus = google.read?.data ?? null;
	if (googleStatus || google.error) {
		entries.push({ key: "google", connected: (googleStatus?.calendars.length ?? 0) > 0, row: <GoogleCalendarRow status={googleStatus} error={google.error} /> });
	}
	return (
		<div className="mx-auto w-full max-w-3xl space-y-8">
			<Section title="Connected" entries={entries.filter(entry => entry.connected)} />
			<Section title="Available" entries={entries.filter(entry => !entry.connected)} />
			<p className="px-1 text-xs text-pretty text-muted-foreground">
				omp keeps its MCP sign-ins in its own credential store, so every omp session can use them. Google Calendar's addresses stay with this dashboard, on this machine.
			</p>
		</div>
	);
}

/** The services omp and the dashboard connect to: omp's MCP servers, each checked by listing its tools, and Google Calendar. */
export function IntegrationsPage() {
	const poll = integrationsStore.usePolling();
	const google = googleStore.usePolling();
	return (
		<ListPage
			title="Integrations"
			meta="Services omp and this dashboard connect to"
			noun="the integrations"
			loading="Checking omp's MCP servers…"
			poll={poll}
			onRefresh={() => {
				void integrationsStore.refresh(null, { fresh: true });
				void googleStore.refresh();
			}}
			notice={null}
			spacing="space-y-4"
		>
			{answer => <Sections answer={answer} google={google} />}
		</ListPage>
	);
}
