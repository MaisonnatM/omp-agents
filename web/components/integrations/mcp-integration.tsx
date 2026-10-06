import { ChevronRight, CircleAlert, ExternalLink, LoaderCircle, LogOut, RefreshCw, WifiOff } from "lucide-react";
import { useId, useState } from "react";
import { type McpConnection, type McpIntegration, type McpIntegrationId, type McpServerRef, type SignInState, signedIn } from "../../../src/shared/accounts";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { type BrandLogo, LINEAR_LOGO } from "./brand-logos";
import { Callout, IntegrationRow, MetaDot, RowMenu } from "./integration-row";

interface Service {
	name: string;
	logo: BrandLogo;
	/** What the connection gives the dashboard and omp's sessions. */
	gives: string;
}

const SERVICES: Record<McpIntegrationId, Service> = {
	linear: {
		name: "Linear",
		logo: LINEAR_LOGO,
		gives: "Your assigned issues on the Tickets tab, and Linear's tools in every omp session.",
	},
};

const STATUS: Record<McpConnection["kind"], { label: string; color: BadgeColor }> = {
	absent: { label: "Not connected", color: "gray" },
	"signed-out": { label: "Signed out", color: "gray" },
	ready: { label: "Connected", color: "green" },
	refused: { label: "Needs reconnecting", color: "red" },
	failing: { label: "Unreachable", color: "amber" },
};

const refresh = (): Promise<void> => integrationsStore.refresh();

/** The tools omp sessions can call, sorted for scanning, and the server they come from. */
function ToolList({ id, tools, server }: { id: string; tools: string[]; server: McpServerRef }) {
	return (
		<div id={id} className="rounded-lg bg-muted/60 p-3">
			<ul aria-label="Tools" className="grid max-h-60 grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto font-mono text-xs text-muted-foreground sm:grid-cols-2">
				{tools.toSorted().map(tool => (
					<li key={tool} className="truncate" title={tool}>
						{tool}
					</li>
				))}
			</ul>
			<p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
				From omp's <code className="font-mono text-foreground">{server.name}</code> MCP server at <span className="font-mono">{server.url}</span>
			</p>
		</div>
	);
}

/** One service whose MCP server omp signs in to: where omp stands with it, and the buttons that sign in and out. */
export function McpIntegrationRow({ integration }: { integration: McpIntegration }) {
	const { id, connection } = integration;
	const service = SERVICES[id];
	const start = async (): Promise<SignInState> => (await putJson<McpIntegration>("/api/integrations/sign-in", { id })).signIn;
	const { starting, waitingUrl, failure, connect } = useSignIn(integration.signIn, refresh, start);
	const [confirming, setConfirming] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	const [signOutError, setSignOutError] = useState<string | null>(null);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [checking, setChecking] = useState(false);
	const toolsId = useId();

	const signOut = async (): Promise<void> => {
		setSigningOut(true);
		setSignOutError(null);
		try {
			await putJson<McpIntegration>("/api/integrations/sign-out", { id });
			await refresh();
		} catch (err) {
			setSignOutError(errorText(err));
		} finally {
			setSigningOut(false);
			setConfirming(false);
		}
	};

	const checkAgain = async (): Promise<void> => {
		setChecking(true);
		try {
			await integrationsStore.refresh(null, { fresh: true });
		} finally {
			setChecking(false);
		}
	};

	const status = waitingUrl ? { label: "Waiting for you", color: "blue" as const } : STATUS[connection.kind];
	const busy = starting || signingOut;
	const reconnect = (
		<Button variant="secondary" size="compact" leadingIcon={RefreshCw} loading={starting} disabled={busy} onClick={() => void connect()}>
			Reconnect
		</Button>
	);

	let actions;
	if (confirming) actions = null;
	else if (signedIn(connection)) {
		actions = (
			<RowMenu name={service.name} disabled={busy}>
				<MenuItem onClick={() => void connect()}>
					<RefreshCw />
					Reconnect
				</MenuItem>
				<MenuSeparator />
				<MenuItem variant="destructive" onClick={() => setConfirming(true)}>
					<LogOut />
					Sign out
				</MenuItem>
			</RowMenu>
		);
	} else if (!waitingUrl) {
		actions = (
			<Button variant="secondary" size="compact" loading={starting} onClick={() => void connect()}>
				Connect
			</Button>
		);
	}

	const host = connection.kind === "absent" ? null : new URL(connection.server.url).host;

	return (
		<IntegrationRow
			name={service.name}
			logo={service.logo}
			summary={service.gives}
			status={<Badge variant="dot" size="compact" color={status.color}>{status.label}</Badge>}
			meta={
				<>
					<span>MCP</span>
					<MetaDot />
					{host ? <span className="font-mono">{host}</span> : <span>Connecting adds it to omp's <code className="font-mono">mcp.json</code></span>}
					{connection.kind === "ready" && (
						<>
							<MetaDot />
							<button
								type="button"
								aria-expanded={toolsOpen}
								aria-controls={toolsOpen ? toolsId : undefined}
								onClick={() => setToolsOpen(open => !open)}
								className="-mx-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
							>
								<span className="tabular-nums">{connection.tools.length}</span> tools
								<ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150 ease-out", toolsOpen && "rotate-90")} />
							</button>
						</>
					)}
				</>
			}
			actions={actions}
		>
			{confirming && (
				<Callout
					tone="danger"
					icon={LogOut}
					action={
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="compact" autoFocus disabled={signingOut} onClick={() => setConfirming(false)}>
								Cancel
							</Button>
							<Button size="compact" loading={signingOut} onClick={() => void signOut()}>
								Sign out
							</Button>
						</div>
					}
				>
					Sign omp out of {service.name}? Its tools leave every omp session until you reconnect.
				</Callout>
			)}
			{waitingUrl && (
				<Callout
					tone="info"
					icon={LoaderCircle}
					spin
					action={
						<Button variant="ghost" size="compact" leadingIcon={ExternalLink} render={<a href={waitingUrl} target="_blank" rel="noreferrer" />}>
							Open sign-in page
						</Button>
					}
				>
					Approve omp on {service.name} in the tab that opened. This updates on its own.
				</Callout>
			)}
			{!waitingUrl && connection.kind === "refused" && (
				<Callout tone="danger" icon={CircleAlert} action={reconnect}>
					{service.name} refused omp's sign-in. Reconnect to sign in again.
				</Callout>
			)}
			{!waitingUrl && connection.kind === "failing" && (
				<Callout
					tone="warning"
					icon={WifiOff}
					action={
						<Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={checking} onClick={() => void checkAgain()}>
							Check again
						</Button>
					}
				>
					{connection.error}
				</Callout>
			)}
			{failure && !waitingUrl && (
				<Callout tone="danger" icon={CircleAlert}>
					Sign-in failed: {failure}
				</Callout>
			)}
			{signOutError && (
				<Callout tone="danger" icon={CircleAlert}>
					Sign-out failed: {signOutError}
				</Callout>
			)}
			{connection.kind === "ready" && toolsOpen && <ToolList id={toolsId} tools={connection.tools} server={connection.server} />}
		</IntegrationRow>
	);
}
