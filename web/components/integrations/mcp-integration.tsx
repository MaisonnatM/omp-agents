/** `McpIntegrationRow`: one MCP-backed service in Settings › Integrations, with its status, sign-in, and tool list. */
import { IconKey1 } from "central-icons";
import { type ReactNode, useState } from "react";
import { MCP_SERVICES, type McpIntegration, type SignInState, signedIn } from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { MoreActionsMenu } from "../more-actions-menu";
import { IntegrationRow, MarkTile, MetaDot } from "./integration-row";
import { ConnectButton, ConnectionCallout, Reconnecting, ReconnectItem, SignOutConfirm, SignOutItem, StatusBadge, useToolList } from "./mcp-connection-controls";
import { integrationStatus, SERVICES } from "./services";
import { SlackAppForm } from "./slack-app-form";

/** One service whose MCP server omp signs in to: where omp stands with it, and the buttons that sign in and out. */
export function McpIntegrationRow({ integration }: { integration: McpIntegration }) {
	const { id, connection, setup } = integration;
	const { label } = MCP_SERVICES[id];
	const service = SERVICES[id];
	const needsSetup = setup !== null && !setup.configured;
	const settingsLabel = "app settings";
	const start = async (): Promise<SignInState> => (await putJson<McpIntegration>("/api/integrations/sign-in", { id })).signIn;
	const signIn = useSignIn(integration.signIn, integrationsStore.refresh, start);
	const { refreshing } = integrationsStore.use();
	const [confirming, setConfirming] = useState(false);
	const [formOpen, setFormOpen] = useState(false);
	const tools = useToolList(connection.kind === "ready" ? connection : null);

	const status = integrationStatus(integration);

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
								<IconKey1 />
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
								<IconKey1 />
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
							await putJson<McpIntegration>("/api/integrations/remove", { id });
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
									<Button variant="secondary" size="compact" leadingIcon={IconKey1} onClick={() => setFormOpen(true)}>
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
