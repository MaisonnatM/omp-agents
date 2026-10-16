import { Power, PowerOff, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MCP_SERVICES, type McpIntegrationId, type SignInState } from "../../../src/shared/accounts";
import { catalogEntry } from "../../../src/shared/mcp-catalog";
import type { McpServerRow, McpServerStatus, McpTransport } from "../../../src/shared/mcp-servers";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { errorText, putJson } from "../../api";
import { integrationsStore, mcpServersStore } from "../../reads";
import { hashForSettings } from "../../routing";
import { useSignIn } from "../../use-sign-in";
import { MoreActionsMenu } from "../more-actions-menu";
import { IntegrationRow, MarkTile, MetaDot } from "./integration-row";
import {
	Confirm,
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
import { SERVICES, STATUS as INTEGRATION_STATUS } from "./services";
import { MCP_LOGOS } from "./mcp-logos";

const refresh = (): Promise<void> => mcpServersStore.refresh();

const TRANSPORT: Record<McpTransport, string> = { http: "HTTP", sse: "SSE", stdio: "Local command" };

/** A server's status, once a row that is one of the integrations went to {@link IntegrationServerRow}. */
type ServerStatus = Exclude<McpServerStatus, { kind: "integration" }>;

const STATUS: Record<ServerStatus["kind"], StatusLabel> = {
	disabled: { label: "Disabled", color: "gray" },
	local: { label: "Not checked", color: "gray" },
	...REMOTE_STATUS,
};

/** Where the server's config lives, when it is not omp's own file, which the page leaves alone. */
const SourceMeta = ({ server }: { server: McpServerRow }) =>
	!server.source.editable && (
		<>
			<MetaDot />
			<span title={server.source.path}>From {server.source.label}</span>
		</>
	);

/** A server that is one of Settings › Integrations' services, or one account of it, which that section checks and signs in to. */
function IntegrationServerRow({ server, id }: { server: McpServerRow; id: McpIntegrationId }) {
	const { label } = MCP_SERVICES[id];
	const integration = integrationsStore.use().read?.data.integrations[id];
	const connection = integration && ("accounts" in integration ? integration.accounts.find(account => account.name === server.name)?.connection : integration.connection);
	return (
		<IntegrationRow
			name={server.name}
			mark={<MarkTile logo={SERVICES[id].logo} name={label} />}
			status={<StatusBadge {...(connection ? INTEGRATION_STATUS[connection.kind] : { label: "Integration", color: "gray" })} />}
			summary={`${label}, which Settings › Integrations signs in to and checks.`}
			meta={
				<>
					<span>{TRANSPORT[server.transport]}</span>
					{server.host && (
						<>
							<MetaDot />
							<span className="font-mono">{server.host}</span>
						</>
					)}
					<SourceMeta server={server} />
				</>
			}
			actions={
				<Button variant="ghost" size="compact" render={<a href={hashForSettings("integrations")} />}>
					Open
				</Button>
			}
		/>
	);
}

/** A server omp loads that is not one of the integrations: where omp stands with it, its sign-in, and the changes its config allows. */
function ServerRow({ server, status }: { server: McpServerRow; status: ServerStatus }) {
	const { name, source } = server;
	const entry = server.catalogId === null ? undefined : catalogEntry(server.catalogId);
	const remote = server.transport !== "stdio" && status.kind !== "disabled";
	const start = async (): Promise<SignInState> => (await putJson<McpServerRow>("/api/mcp-servers/sign-in", { name })).signIn;
	const signIn = useSignIn(server.signIn, refresh, start);
	const { refreshing } = mcpServersStore.use();
	const [confirming, setConfirming] = useState<"sign-out" | "remove" | null>(null);
	const [toggling, setToggling] = useState(false);
	const [toggleError, setToggleError] = useState<string | null>(null);
	const tools = useToolList(status.kind === "ready" ? { tools: status.tools, server: { name, url: server.url ?? "" } } : null);

	const setEnabled = async (enabled: boolean): Promise<void> => {
		setToggling(true);
		setToggleError(null);
		try {
			await putJson<McpServerRow>("/api/mcp-servers/enabled", { name, enabled });
			await refresh();
		} catch (err) {
			setToggleError(errorText(err));
		} finally {
			setToggling(false);
		}
	};

	const badge = signIn.waitingUrl ? WAITING_STATUS : STATUS[status.kind];
	const busy = signIn.starting || toggling;

	const menuItems: ReactNode[] = [];
	if (remote && (server.signedIn || status.kind === "refused")) menuItems.push(<ReconnectItem key="reconnect" signIn={signIn} />);
	if (server.transport !== "stdio" && server.signedIn) menuItems.push(<SignOutItem key="sign-out" onClick={() => setConfirming("sign-out")} />);
	if (source.editable) {
		if (status.kind !== "disabled") {
			menuItems.push(
				<MenuItem key="disable" onClick={() => void setEnabled(false)}>
					<PowerOff />
					Disable
				</MenuItem>,
			);
		}
		menuItems.push(
			<MenuSeparator key="separator" />,
			<MenuItem key="remove" variant="destructive" onClick={() => setConfirming("remove")}>
				<Trash2 />
				Remove
			</MenuItem>,
		);
	}

	let actions: ReactNode = null;
	if (!signIn.waitingUrl && confirming === null) {
		actions = (
			<>
				{status.kind === "signed-out" ? <ConnectButton signIn={signIn} /> : <Reconnecting signIn={signIn} />}
				{status.kind === "disabled" && source.editable && (
					<Button variant="secondary" size="compact" leadingIcon={Power} loading={toggling} onClick={() => void setEnabled(true)}>
						Enable
					</Button>
				)}
				{menuItems.length > 0 && (
					<MoreActionsMenu name={name} disabled={busy}>
						{menuItems}
					</MoreActionsMenu>
				)}
			</>
		);
	}

	const callout = (
		<ConnectionCallout
			approveOn={entry?.label ?? server.host ?? name}
			signIn={signIn}
			question={
				confirming === "sign-out" ? (
					<SignOutConfirm
						name={name}
						signOut={async () => {
							await putJson<McpServerRow>("/api/mcp-servers/sign-out", { name });
							await refresh();
						}}
						onDone={() => setConfirming(null)}
					/>
				) : (
					confirming === "remove" && (
						<Confirm
							icon={Trash2}
							question={`Remove ${name} from omp's mcp.json?`}
							detail="New omp sessions stop loading its tools. omp keeps its sign-in, as /mcp remove does."
							confirm="Remove"
							run={async () => {
								await putJson<object>("/api/mcp-servers/remove", { name });
								await refresh();
							}}
							onDone={() => setConfirming(null)}
						/>
					)
				)
			}
			error={toggleError && `Cannot change ${name}: ${toggleError}`}
			refused={status.kind === "refused" ? { message: status.error } : null}
			failing={
				status.kind === "failing" ? { message: status.error, checking: refreshing, check: () => void mcpServersStore.refresh(null, { fresh: true }) } : null
			}
		/>
	);

	const where = server.transport === "stdio" ? server.command : server.host;
	return (
		<IntegrationRow
			name={name}
			mark={<MarkTile logo={(server.catalogId === null ? undefined : MCP_LOGOS[server.catalogId]) ?? null} name={name} />}
			status={<StatusBadge {...badge} />}
			summary={
				entry?.description ??
				(server.transport === "stdio" ? (
					"Runs on this computer when an omp session starts, so this page does not check it."
				) : (
					<span className="font-mono text-xs break-all">{server.url}</span>
				))
			}
			meta={
				<>
					<span>{TRANSPORT[server.transport]}</span>
					{where && (
						<>
							<MetaDot />
							<span className="max-w-72 truncate font-mono" title={where}>
								{where}
							</span>
						</>
					)}
					<SourceMeta server={server} />
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
			{tools.list}
		</IntegrationRow>
	);
}

/** One MCP server omp loads: an integration's points to its section; any other shows its status, sign-in, and config changes. */
export function McpServerItem({ server }: { server: McpServerRow }) {
	return server.status.kind === "integration" ? <IntegrationServerRow server={server} id={server.status.id} /> : <ServerRow server={server} status={server.status} />;
}
