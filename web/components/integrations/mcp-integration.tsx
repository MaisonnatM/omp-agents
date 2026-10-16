/** `McpIntegrationRow`: one MCP-backed service in Settings › Integrations, with its status, sign-in, and tool list, or its accounts. */
import { KeyRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type GoogleAccount, hasAccounts, MCP_SERVICES, type McpIntegration, type SignInState, type SingleService, signedIn } from "../../../src/shared/accounts";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { MoreActionsMenu } from "../more-actions-menu";
import { GoogleAccountsRow } from "./google-accounts";
import { IntegrationRow, MarkTile, MetaDot } from "./integration-row";
import { ConnectButton, ConnectionCallout, Reconnecting, ReconnectItem, SignOutConfirm, SignOutItem, StatusBadge, useToolList, WAITING_STATUS } from "./mcp-connection-controls";
import { SERVICES, STATUS } from "./services";
import { SlackAppForm } from "./slack-app-form";

/** A service that signs in to one server: where omp stands with it, and the buttons that sign in and out. */
function ServerIntegrationRow({ integration }: { integration: McpIntegration<SingleService> }) {
	const { id, connection, setup } = integration;
	const { label } = MCP_SERVICES[id];
	const service = SERVICES[id];
	const needsSetup = setup !== null && !setup.configured;
	const settingsLabel = id === "slack" ? "app settings" : "OAuth client";
	const start = async (): Promise<SignInState> => (await putJson<McpIntegration>("/api/integrations/sign-in", { id, account: null })).signIn;
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

	const callout = (
		<ConnectionCallout
			approveOn={label}
			signIn={signIn}
			question={
				confirming && (
					<SignOutConfirm
						name={label}
						signOut={async () => {
							await putJson<McpIntegration>("/api/integrations/remove", { id, account: null });
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
			failing={connection.kind !== "failing" ? null : { message: connection.error, checking: refreshing, check: () => void integrationsStore.refresh(null, { fresh: true }) }}
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
			{tools.list}
		</IntegrationRow>
	);
}

interface McpIntegrationRowProps {
	integration: McpIntegration;
	/** The workspaces a Google account may be linked to; `null` where links are not edited. */
	workspaces: Workspace[] | null;
	/** What shows once above a Google service's accounts, such as why none of their calendars could be listed. */
	notice?: ReactNode;
	/** What shows under each Google account, such as its calendars. */
	details?: (account: GoogleAccount) => ReactNode;
}

/** One service whose MCP server omp signs in to, or whose accounts it signs in to, one server each. */
export function McpIntegrationRow({ integration, workspaces, notice, details }: McpIntegrationRowProps) {
	return hasAccounts(integration) ? (
		<GoogleAccountsRow integration={integration} workspaces={workspaces} notice={notice} details={details} />
	) : (
		<ServerIntegrationRow integration={integration} />
	);
}
