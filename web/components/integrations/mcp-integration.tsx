/** `McpIntegrationRow`: one MCP-backed service in Settings › Integrations, with its status, sign-in, and tool list. */
import { ExternalLink, KeyRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	googleMcpEnableUrl,
	isGoogleIntegration,
	MCP_SERVICES,
	type McpConnection,
	type McpIntegration,
	type McpIntegrationId,
	type SignInState,
	signedIn,
} from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { MoreActionsMenu } from "../more-actions-menu";
import { type BrandLogo, GMAIL_LOGO, GOOGLE_CALENDAR_LOGO, LINEAR_LOGO, SLACK_LOGO } from "./brand-logos";
import { GOOGLE_TEXT, GoogleClientForm } from "./google-client-form";
import { IntegrationRow, MarkTile, MetaDot } from "./integration-row";
import {
	ConnectButton,
	ConnectionCallout,
	Reconnecting,
	ReconnectItem,
	REMOTE_STATUS,
	SignOutConfirm,
	SignOutItem,
	StatusBadge,
	type StatusLabel,
	useToolList,
	WAITING_STATUS,
} from "./mcp-connection-controls";
import { SlackAppForm } from "./slack-app-form";

interface Service {
	logo: BrandLogo;
	/** What the connection gives the dashboard and omp's sessions. */
	gives: string;
	/** What the service's own OAuth client is called, for a service that needs one. */
	client?: string;
}

export const SERVICES: Record<McpIntegrationId, Service> = {
	linear: {
		logo: LINEAR_LOGO,
		gives: "Your assigned issues on the Tickets tab, and Linear's tools in every omp session.",
	},
	slack: {
		logo: SLACK_LOGO,
		gives: "Search, read, and send in the conversations you grant, in every omp session.",
		client: "Dedicated internal app",
	},
	"google-calendar": {
		logo: GOOGLE_CALENDAR_LOGO,
		gives: "Your calendars' events on the Calendar tab, and Google Calendar's tools in every omp session.",
		client: "Your Google OAuth client",
	},
	gmail: {
		logo: GMAIL_LOGO,
		gives: "Your inbox on the Inbox tab, with replies and Delete, and Gmail's tools in every omp session.",
		client: "Your Google OAuth client",
	},
};

export const STATUS: Record<McpConnection["kind"], StatusLabel> = { absent: { label: "Not connected", color: "gray" }, ...REMOTE_STATUS };

/** For a Google row whose MCP server answered 403, the API to turn on and Google's page that turns it on; otherwise `null`. */
function googleApiOff(integration: McpIntegration, connection: Extract<McpConnection, { kind: "failing" }>): { api: string; url: string } | null {
	if (!isGoogleIntegration(integration) || connection.status !== 403 || !integration.setup.clientId) return null;
	const url = googleMcpEnableUrl(connection.server.host, integration.setup.clientId);
	return url ? { api: GOOGLE_TEXT[integration.id].mcpApi, url } : null;
}

/** One service whose MCP server omp signs in to: where omp stands with it, the buttons that sign in and out, and `children` below. */
export function McpIntegrationRow({ integration, children }: { integration: McpIntegration; children?: ReactNode }) {
	const { id, connection, setup } = integration;
	const { label } = MCP_SERVICES[id];
	const service = SERVICES[id];
	const needsSetup = setup !== null && !setup.configured;
	const settingsLabel = id === "slack" ? "app settings" : "OAuth client";
	const start = async (): Promise<SignInState> => (await putJson<McpIntegration>("/api/integrations/sign-in", { id })).signIn;
	const signIn = useSignIn(integration.signIn, integrationsStore.refresh, start);
	const { refreshing } = integrationsStore.use();
	const [confirming, setConfirming] = useState(false);
	const [formOpen, setFormOpen] = useState(false);
	const tools = useToolList(connection.kind === "ready" ? connection : null);

	const status = signIn.waitingUrl ? WAITING_STATUS : needsSetup && !signedIn(connection) ? { label: "Not set up", color: "gray" as const } : STATUS[connection.kind];

	let actions: ReactNode = null;
	if (!signIn.waitingUrl && !confirming && !formOpen) {
		if (needsSetup && !signedIn(connection)) {
			actions = (
				<Button variant="secondary" size="compact" onClick={() => setFormOpen(true)}>
					Set up
				</Button>
			);
		} else if (signedIn(connection)) {
			actions = (
				<>
					<Reconnecting signIn={signIn} />
					<MoreActionsMenu name={label} disabled={signIn.starting}>
						{!needsSetup && <ReconnectItem signIn={signIn} />}
						{setup !== null && (
							<MenuItem onClick={() => setFormOpen(true)}>
								<KeyRound />
								{setup.configured ? `Replace ${settingsLabel}` : "Set up"}
							</MenuItem>
						)}
						<MenuSeparator />
						<SignOutItem destructive onClick={() => setConfirming(true)} />
					</MoreActionsMenu>
				</>
			);
		} else {
			actions = (
				<>
					<ConnectButton signIn={signIn} />
					{setup !== null && (
						<MoreActionsMenu name={label} disabled={signIn.starting}>
							<MenuItem onClick={() => setFormOpen(true)}>
								<KeyRound />
								Replace {settingsLabel}
							</MenuItem>
						</MoreActionsMenu>
					)}
				</>
			);
		}
	}

	const apiOff = connection.kind === "failing" ? googleApiOff(integration, connection) : null;
	const callout = (
		<ConnectionCallout
			approveOn={label}
			signIn={signIn}
			question={
				confirming && (
					<SignOutConfirm
						name={label}
						signOut={async () => {
							await putJson<McpIntegration>("/api/integrations/sign-out", { id });
							await integrationsStore.refresh();
						}}
						onDone={() => setConfirming(false)}
					/>
				)
			}
			refused={
				connection.kind !== "refused"
					? null
					: needsSetup
						? {
								message: `Complete the ${label} ${settingsLabel} before you reconnect.`,
								fix: (
									<Button variant="secondary" size="compact" leadingIcon={KeyRound} onClick={() => setFormOpen(true)}>
										Set up
									</Button>
								),
							}
						: { message: `${label} refused omp's sign-in. Reconnect to sign in again.` }
			}
			failing={
				connection.kind !== "failing"
					? null
					: {
							message: apiOff
								? `Google refused ${label}'s tools to omp's sessions (HTTP 403), most often because the ${apiOff.api} is off in your OAuth client's Google Cloud project.`
								: connection.error,
							checking: refreshing,
							check: () => void integrationsStore.refresh(null, { fresh: true }),
							fix: apiOff && (
								<Button variant="secondary" size="compact" leadingIcon={ExternalLink} render={<a href={apiOff.url} target="_blank" rel="noreferrer" />}>
									Enable {apiOff.api}
								</Button>
							),
						}
			}
		/>
	);

	return (
		<IntegrationRow
			name={label}
			mark={<MarkTile logo={service.logo} name={label} />}
			summary={service.gives}
			status={<StatusBadge {...status} />}
			meta={
				<>
					<span>MCP</span>
					<MetaDot />
					{needsSetup ? (
						<span>{service.client}</span>
					) : connection.kind === "absent" ? (
						<span>
							Connecting adds it to omp's <code className="font-mono">mcp.json</code>
						</span>
					) : (
						<span className="font-mono">{connection.server.host}</span>
					)}
					{integration.id === "slack" && integration.setup.configured && integration.setup.redirectUri && (
						<>
							<MetaDot />
							<span className="max-w-56 truncate font-mono" title={integration.setup.redirectUri}>
								{integration.setup.redirectUri}
							</span>
						</>
					)}
					{setup?.configured && (
						<>
							<MetaDot />
							<span>
								callback <span className="font-mono">localhost:{setup.callbackPort}</span>
							</span>
						</>
					)}
					{tools.toggle && (
						<>
							<MetaDot />
							{tools.toggle}
						</>
					)}
				</>
			}
			actions={actions}
		>
			{callout}
			{formOpen && integration.id === "slack" && <SlackAppForm setup={integration.setup} connected={signedIn(connection)} onDone={() => setFormOpen(false)} />}
			{formOpen && isGoogleIntegration(integration) && (
				<GoogleClientForm id={integration.id} setup={integration.setup} connected={signedIn(connection)} onDone={() => setFormOpen(false)} />
			)}
			{children}
			{tools.list}
		</IntegrationRow>
	);
}
