import { type LucideIcon, CircleAlert, ExternalLink, LoaderCircle, LogOut, Power, PowerOff, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { MCP_SERVICES, type McpIntegrationId, type SignInState } from "../../../src/shared/accounts";
import { catalogEntry } from "../../../src/shared/mcp-catalog";
import type { McpServerRow, McpServerStatus, McpTransport } from "../../../src/shared/mcp-servers";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { errorText, putJson } from "../../api";
import { integrationsStore, mcpServersStore } from "../../reads";
import { hashForSettings } from "../../routing";
import { useSignIn } from "../../use-sign-in";
import { MoreActionsMenu } from "../more-actions-menu";
import type { BrandLogo } from "./brand-logos";
import { Callout, IntegrationRow, MarkTile, MetaDot } from "./integration-row";
import { SERVICES, STATUS as INTEGRATION_STATUS, ToolList, ToolsToggle } from "./mcp-integration";
import { MCP_LOGO_PATHS } from "./mcp-logo-paths";

const refresh = (): Promise<void> => mcpServersStore.refresh();

/** A catalog vendor's mark in the text color, or `null` when Simple Icons has none for it. */
export function catalogLogo(catalogId: string | null): BrandLogo | null {
	const path = catalogId === null ? undefined : MCP_LOGO_PATHS[catalogId];
	return path === undefined ? null : { path, color: "currentColor" };
}

const TRANSPORT: Record<McpTransport, string> = { http: "HTTP", sse: "SSE", stdio: "Local command" };

const STATUS: Record<Exclude<McpServerStatus["kind"], "integration">, { label: string; color: BadgeColor }> = {
	disabled: { label: "Disabled", color: "gray" },
	local: { label: "Not checked", color: "gray" },
	"signed-out": { label: "Signed out", color: "gray" },
	ready: { label: "Connected", color: "green" },
	refused: { label: "Needs reconnecting", color: "red" },
	failing: { label: "Unreachable", color: "amber" },
};

const StatusBadge = ({ label, color }: { label: string; color: BadgeColor }) => (
	<Badge variant="dot" size="compact" color={color}>
		{label}
	</Badge>
);

interface ConfirmProps {
	icon: LucideIcon;
	question: string;
	detail: string;
	confirm: string;
	run: () => Promise<void>;
	onDone: () => void;
}

/** Asks `question` before `run`; a failure stays in the question, to try again or cancel. */
function Confirm({ icon, question, detail, confirm, run, onDone }: ConfirmProps) {
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const go = async (): Promise<void> => {
		setRunning(true);
		setError(null);
		try {
			await run();
			onDone();
		} catch (err) {
			setError(errorText(err));
			setRunning(false);
		}
	};

	return (
		<Callout
			tone="danger"
			icon={icon}
			role="group"
			label={question}
			action={
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="compact" autoFocus disabled={running} onClick={onDone}>
						Cancel
					</Button>
					<Button size="compact" loading={running} onClick={() => void go()}>
						{confirm}
					</Button>
				</div>
			}
		>
			{question} {detail}
			{error && (
				<p role="alert" className="mt-1">
					{confirm} failed: {error}
				</p>
			)}
		</Callout>
	);
}

/** Where the server's config lives, when it is not omp's own file, which the page leaves alone. */
const SourceMeta = ({ server }: { server: McpServerRow }) =>
	!server.source.editable && (
		<>
			<MetaDot />
			<span title={server.source.path}>From {server.source.label}</span>
		</>
	);

/** A server that is one of Settings › Integrations' services, which that section checks and signs in to. */
function IntegrationServerRow({ server, id }: { server: McpServerRow; id: McpIntegrationId }) {
	const { label } = MCP_SERVICES[id];
	const connection = integrationsStore.use().read?.data.integrations[id].connection;
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
function ServerRow({ server }: { server: McpServerRow }) {
	const { name, status, source } = server;
	const entry = server.catalogId === null ? undefined : catalogEntry(server.catalogId);
	const remote = server.transport !== "stdio" && status.kind !== "disabled";
	const start = async (): Promise<SignInState> => (await putJson<McpServerRow>("/api/mcp-servers/sign-in", { name })).signIn;
	const { starting, waitingUrl, failure, connect } = useSignIn(server.signIn, refresh, start);
	const { refreshing } = mcpServersStore.use();
	const [confirming, setConfirming] = useState<"sign-out" | "remove" | null>(null);
	const [toggling, setToggling] = useState(false);
	const [toggleError, setToggleError] = useState<string | null>(null);
	const [toolsOpen, setToolsOpen] = useState(false);
	const toolsId = useId();

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

	const badge = waitingUrl ? { label: "Waiting for you", color: "blue" as const } : STATUS[status.kind as keyof typeof STATUS];
	const busy = starting || toggling;

	const menuItems: ReactNode[] = [];
	if (remote && (server.signedIn || status.kind === "refused")) {
		menuItems.push(
			<MenuItem key="reconnect" onClick={() => void connect()}>
				<RefreshCw />
				Reconnect
			</MenuItem>,
		);
	}
	if (server.transport !== "stdio" && server.signedIn) {
		menuItems.push(
			<MenuItem key="sign-out" onClick={() => setConfirming("sign-out")}>
				<LogOut />
				Sign out
			</MenuItem>,
		);
	}
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
	if (!waitingUrl && confirming === null) {
		actions = (
			<>
				{status.kind === "signed-out" && (
					<Button variant="secondary" size="compact" loading={starting} onClick={() => void connect()}>
						Connect
					</Button>
				)}
				{status.kind === "disabled" && source.editable && (
					<Button variant="secondary" size="compact" leadingIcon={Power} loading={toggling} onClick={() => void setEnabled(true)}>
						Enable
					</Button>
				)}
				{status.kind !== "signed-out" && starting && (
					<span role="status" aria-busy className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<LoaderCircle aria-hidden className="size-3.5 animate-spin" />
						Reconnecting…
					</span>
				)}
				{menuItems.length > 0 && (
					<MoreActionsMenu name={name} disabled={busy}>
						{menuItems}
					</MoreActionsMenu>
				)}
			</>
		);
	}

	let callout: ReactNode = null;
	if (waitingUrl) {
		callout = (
			<Callout
				tone="info"
				icon={LoaderCircle}
				role="status"
				spin
				action={
					<Button variant="ghost" size="compact" leadingIcon={ExternalLink} render={<a href={waitingUrl} target="_blank" rel="noreferrer" />}>
						Open sign-in page
					</Button>
				}
			>
				Approve omp on {entry?.label ?? server.host ?? name} in the tab that opened. This updates on its own.
			</Callout>
		);
	} else if (confirming === "sign-out") {
		callout = (
			<Confirm
				icon={LogOut}
				question={`Sign omp out of ${name}?`}
				detail="Its tools leave every omp session until you connect again."
				confirm="Sign out"
				run={async () => {
					await putJson<McpServerRow>("/api/mcp-servers/sign-out", { name });
					await refresh();
				}}
				onDone={() => setConfirming(null)}
			/>
		);
	} else if (confirming === "remove") {
		callout = (
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
		);
	} else if (failure || toggleError) {
		callout = (
			<Callout tone="danger" icon={CircleAlert} role="alert">
				{failure ? `Sign-in failed: ${failure}` : `Cannot change ${name}: ${toggleError}`}
			</Callout>
		);
	} else if (status.kind === "refused") {
		callout = (
			<Callout
				tone="danger"
				icon={CircleAlert}
				action={
					<Button variant="secondary" size="compact" leadingIcon={RefreshCw} loading={starting} onClick={() => void connect()}>
						Reconnect
					</Button>
				}
			>
				{status.error}
			</Callout>
		);
	} else if (status.kind === "failing") {
		callout = (
			<Callout
				tone="warning"
				icon={WifiOff}
				action={
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={refreshing} onClick={() => void mcpServersStore.refresh(null, { fresh: true })}>
						Check again
					</Button>
				}
			>
				{status.error}
			</Callout>
		);
	}

	const where = server.transport === "stdio" ? server.command : server.host;
	return (
		<IntegrationRow
			name={name}
			mark={<MarkTile logo={catalogLogo(server.catalogId)} name={name} />}
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
					{status.kind === "ready" && (
						<>
							<MetaDot />
							<ToolsToggle count={status.tools.length} open={toolsOpen} controls={toolsId} onToggle={() => setToolsOpen(open => !open)} />
						</>
					)}
				</>
			}
			actions={actions}
		>
			{callout}
			{status.kind === "ready" && toolsOpen && <ToolList id={toolsId} tools={status.tools} server={{ name, url: server.url ?? "" }} />}
		</IntegrationRow>
	);
}

/** One MCP server omp loads: an integration's points to its section; any other shows its status, sign-in, and config changes. */
export function McpServerItem({ server }: { server: McpServerRow }) {
	return server.status.kind === "integration" ? <IntegrationServerRow server={server} id={server.status.id} /> : <ServerRow server={server} />;
}
