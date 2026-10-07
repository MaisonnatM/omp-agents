import { ChevronRight, CircleAlert, ExternalLink, KeyRound, LoaderCircle, LogOut, RefreshCw, WifiOff } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { MCP_SERVICES, type McpConnection, type McpIntegration, type McpIntegrationId, type McpServerRef, type SignInState, signedIn } from "../../../src/shared/accounts";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { MoreActionsMenu } from "../more-actions-menu";
import { type BrandLogo, LINEAR_LOGO, SLACK_LOGO } from "./brand-logos";
import { Callout, IntegrationRow, MetaDot } from "./integration-row";
import { SlackAppForm } from "./slack-app-form";

interface Service {
	logo: BrandLogo;
	/** What the connection gives the dashboard and omp's sessions. */
	gives: string;
}

const SERVICES: Record<McpIntegrationId, Service> = {
	linear: {
		logo: LINEAR_LOGO,
		gives: "Your assigned issues on the Tickets tab, and Linear's tools in every omp session.",
	},
	slack: {
		logo: SLACK_LOGO,
		gives: "Search, read, and send in the conversations you grant, in every omp session.",
	},
};

const STATUS: Record<McpConnection["kind"], { label: string; color: BadgeColor }> = {
	absent: { label: "Not connected", color: "gray" },
	"signed-out": { label: "Signed out", color: "gray" },
	ready: { label: "Connected", color: "green" },
	refused: { label: "Needs reconnecting", color: "red" },
	failing: { label: "Unreachable", color: "amber" },
};

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

/** Asks before signing omp out of `name`, then signs out; a failure stays in the question, to try again or cancel. */
function SignOutConfirm({ id, name, onDone }: { id: McpIntegrationId; name: string; onDone: () => void }) {
	const [signingOut, setSigningOut] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const signOut = async (): Promise<void> => {
		setSigningOut(true);
		setError(null);
		try {
			await putJson<McpIntegration>("/api/integrations/sign-out", { id });
			await integrationsStore.refresh();
			onDone();
		} catch (err) {
			setError(errorText(err));
			setSigningOut(false);
		}
	};

	return (
		<Callout
			tone="danger"
			icon={LogOut}
			role="group"
			label={`Sign omp out of ${name}?`}
			action={
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="compact" autoFocus disabled={signingOut} onClick={onDone}>
						Cancel
					</Button>
					<Button size="compact" loading={signingOut} onClick={() => void signOut()}>
						Sign out
					</Button>
				</div>
			}
		>
			Sign omp out of {name}? Its tools leave every omp session until you reconnect.
			{error && (
				<p role="alert" className="mt-1">
					Sign-out failed: {error}
				</p>
			)}
		</Callout>
	);
}

/** One service whose MCP server omp signs in to: where omp stands with it, and the buttons that sign in and out. */
export function McpIntegrationRow({ integration }: { integration: McpIntegration }) {
	const { id, connection } = integration;
	const { label } = MCP_SERVICES[id];
	const service = SERVICES[id];
	const setup = id === "slack" ? integration.setup : null;
	const needsSetup = id === "slack" && !setup?.configured;
	const start = async (): Promise<SignInState> => (await putJson<McpIntegration>("/api/integrations/sign-in", { id })).signIn;
	const { starting, waitingUrl, failure, connect } = useSignIn(integration.signIn, integrationsStore.refresh, start);
	const { refreshing } = integrationsStore.use();
	const [confirming, setConfirming] = useState(false);
	const [formOpen, setFormOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const toolsId = useId();

	const status = waitingUrl ? { label: "Waiting for you", color: "blue" as const } : needsSetup && !signedIn(connection) ? { label: "Not set up", color: "gray" as const } : STATUS[connection.kind];

	let actions: ReactNode = null;
	if (!waitingUrl && !confirming && !formOpen) {
		if (needsSetup && !signedIn(connection)) {
			actions = (
				<Button variant="secondary" size="compact" onClick={() => setFormOpen(true)}>
					Set up
				</Button>
			);
		} else if (signedIn(connection)) {
			actions = (
				<MoreActionsMenu name={label} disabled={starting}>
					{!needsSetup && (
						<MenuItem onClick={() => void connect()}>
							<RefreshCw />
							Reconnect
						</MenuItem>
					)}
					{id === "slack" && (
						<MenuItem onClick={() => setFormOpen(true)}>
							<KeyRound />
							{setup?.configured ? "Replace app settings" : "Set up"}
						</MenuItem>
					)}
					<MenuSeparator />
					<MenuItem variant="destructive" onClick={() => setConfirming(true)}>
						<LogOut />
						Sign out
					</MenuItem>
				</MoreActionsMenu>
			);
		} else {
			actions = (
				<>
					<Button variant="secondary" size="compact" loading={starting} onClick={() => void connect()}>
						Connect
					</Button>
					{id === "slack" && (
						<MoreActionsMenu name={label} disabled={starting}>
							<MenuItem onClick={() => setFormOpen(true)}>
								<KeyRound />
								Replace app settings
							</MenuItem>
						</MoreActionsMenu>
					)}
				</>
			);
		}
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
				Approve omp on {label} in the tab that opened. This updates on its own.
			</Callout>
		);
	} else if (confirming) {
		callout = <SignOutConfirm id={id} name={label} onDone={() => setConfirming(false)} />;
	} else if (failure) {
		callout = (
			<Callout tone="danger" icon={CircleAlert} role="alert">
				Sign-in failed: {failure}
			</Callout>
		);
	} else if (connection.kind === "refused") {
		callout = (
			<Callout
				tone="danger"
				icon={CircleAlert}
				action={
					<Button variant="secondary" size="compact" leadingIcon={needsSetup ? KeyRound : RefreshCw} loading={starting} onClick={() => needsSetup ? setFormOpen(true) : void connect()}>
						{needsSetup ? "Set up" : "Reconnect"}
					</Button>
				}
			>
				{needsSetup ? "Complete the Slack app settings before you reconnect." : `${label} refused omp's sign-in. Reconnect to sign in again.`}
			</Callout>
		);
	} else if (connection.kind === "failing") {
		callout = (
			<Callout
				tone="warning"
				icon={WifiOff}
				action={
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={refreshing} onClick={() => void integrationsStore.refresh(null, { fresh: true })}>
						Check again
					</Button>
				}
			>
				{connection.error}
			</Callout>
		);
	}

	return (
		<IntegrationRow
			name={label}
			logo={service.logo}
			summary={service.gives}
			status={
				<Badge variant="dot" size="compact" color={status.color}>
					{status.label}
				</Badge>
			}
			meta={
				<>
					<span>MCP</span>
					<MetaDot />
					{needsSetup ? (
						<span>Dedicated internal app</span>
					) : connection.kind === "absent" ? (
						<span>
							Connecting adds it to omp's <code className="font-mono">mcp.json</code>
						</span>
					) : (
						<span className="font-mono">{connection.server.host}</span>
					)}
					{setup?.configured && setup.redirectUri && (
						<>
							<MetaDot />
							<span className="max-w-56 truncate font-mono" title={setup.redirectUri}>
								{setup.redirectUri}
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
			{callout}
			{formOpen && <SlackAppForm setup={setup} connected={signedIn(connection)} onDone={() => setFormOpen(false)} />}
			{connection.kind === "ready" && toolsOpen && <ToolList id={toolsId} tools={connection.tools} server={connection.server} />}
		</IntegrationRow>
	);
}
