/** `GoogleAccountsRow`: a Google service in Settings › Integrations with its accounts, each signed in, reconnected, removed, and linked to workspaces on its own. */
import { ExternalLink, FolderOpen, KeyRound, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	type AccountsService,
	type GoogleAccount,
	type GoogleLinks,
	type IntegrationsAnswer,
	MCP_SERVICES,
	type McpIntegration,
	type SignInState,
	signedIn,
} from "../../../src/shared/accounts";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { errorText, putJson } from "../../api";
import { integrationsStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { CommandPicker } from "../command-picker";
import { MoreActionsMenu } from "../more-actions-menu";
import { GoogleClientForm } from "./google-client-form";
import { IntegrationRow, MarkTile, MetaDot } from "./integration-row";
import { Confirm, ConnectionCallout, Reconnecting, ReconnectItem, StatusBadge, type StatusLabel, useToolList, WAITING_STATUS } from "./mcp-connection-controls";
import { googleApiOff, SERVICES, STATUS } from "./services";

type AccountsIntegration = McpIntegration<AccountsService>;

const startSignIn = async (id: AccountsService, account: string | null): Promise<SignInState> =>
	(await putJson<McpIntegration>("/api/integrations/sign-in", { id, account })).signIn;

/** The workspaces account `account` is linked to, as the picker's trigger says them. */
function linkLabel(account: GoogleAccount, workspaces: Workspace[]): string {
	const names = account.workspaces.map(cwd => workspaces.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd);
	return names.length === 0 ? "All workspaces" : names.length === 1 ? names[0]! : `${names.length} workspaces`;
}

/** The link writes under way, by address, each after the one before; each resolves to the workspaces it saved. */
const linkWrites = new Map<string, Promise<readonly string[]>>();

/**
 * Links or unlinks `cwd` for Google address `address`, after any write for it under way, from the workspaces that write
 * saved, else from `linked`, so two quick toggles both stand.
 */
function toggleLink(address: string, linked: readonly string[], cwd: string): Promise<readonly string[]> {
	const write = (linkWrites.get(address) ?? Promise.resolve(linked))
		.catch(() => linked)
		.then(async current => {
			const workspaces = current.includes(cwd) ? current.filter(other => other !== cwd) : [...current, cwd];
			const answer = await putJson<IntegrationsAnswer>("/api/integrations/google-links", { address, workspaces } satisfies GoogleLinks);
			integrationsStore.update(() => answer);
			return workspaces;
		});
	linkWrites.set(address, write);
	const settle = (): void => {
		if (linkWrites.get(address) === write) linkWrites.delete(address);
	};
	write.then(settle, settle);
	return write;
}

/**
 * The workspaces Google address `address`'s accounts are linked to: each pick links or unlinks one, and none shows the
 * accounts in every workspace. A link to a workspace no longer listed stays checked until you uncheck it.
 */
function WorkspaceLinks({ account, address, workspaces }: { account: GoogleAccount; address: string; workspaces: Workspace[] }) {
	const [error, setError] = useState<string | null>(null);
	const listed = new Set(workspaces.map(workspace => workspace.cwd));
	const options = [...workspaces.map(workspace => ({ cwd: workspace.cwd, label: workspace.cwdDisplay })), ...account.workspaces.filter(cwd => !listed.has(cwd)).map(cwd => ({ cwd, label: cwd }))];
	const toggle = async (cwd: string): Promise<void> => {
		setError(null);
		try {
			await toggleLink(address, account.workspaces, cwd);
		} catch (err) {
			setError(errorText(err));
		}
	};
	return (
		<span className="inline-flex items-center gap-1.5">
			<CommandPicker
				trigger={<span className="max-w-48 truncate">{linkLabel(account, workspaces)}</span>}
				icon={FolderOpen}
				ariaLabel={`Workspaces of ${address}: ${linkLabel(account, workspaces)}`}
				tooltip="Pages and sessions in these workspaces use this account; none shows it everywhere"
				search={{ label: "Search workspaces" }}
				width="lg"
				list={{
					kind: "ready",
					groups: [
						{
							key: "workspaces",
							heading: "Linked workspaces",
							items: options.map(({ cwd, label }) => ({ value: cwd, label: <span className="truncate">{label}</span>, selected: account.workspaces.includes(cwd), onSelect: () => void toggle(cwd) })),
						},
					],
				}}
				empty="No workspace matches."
			/>
			{error && (
				<span role="alert" className="text-red-600 dark:text-red-400">
					{error}
				</span>
			)}
		</span>
	);
}

interface AccountRowProps {
	integration: AccountsIntegration;
	account: GoogleAccount;
	/** Whether it is the service's only server, which keeps the OAuth client and so stays, signed out, when removed. */
	last: boolean;
	/** The workspaces it may be linked to; `null` where links are not edited. */
	workspaces: Workspace[] | null;
	children?: ReactNode;
}

/** One account of a Google service: its address, where omp stands with it, Reconnect and Remove, its workspace links, and its tools. */
function AccountRow({ integration, account, last, workspaces, children }: AccountRowProps) {
	const { id } = integration;
	const { label } = MCP_SERVICES[id];
	const { name, address, addressError, connection } = account;
	const shown = address ?? name;
	const signIn = useSignIn(integration.signIn?.account === name ? integration.signIn : null, integrationsStore.refresh, () => startSignIn(id, name));
	const { refreshing } = integrationsStore.use();
	const [removing, setRemoving] = useState(false);
	const tools = useToolList(connection.kind === "ready" ? connection : null);
	const status: StatusLabel = signIn.waitingUrl ? WAITING_STATUS : STATUS[connection.kind];
	const apiOff = connection.kind === "failing" ? googleApiOff(integration, connection) : null;
	return (
		<li className="space-y-2 py-3 first:pt-0 last:pb-0">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="truncate text-[13px] font-medium" title={shown}>
							{shown}
						</span>
						<StatusBadge {...status} />
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
						<span className="font-mono" title="Its server in omp's mcp.json">
							{name}
						</span>
						{workspaces && address && (
							<>
								<MetaDot />
								<WorkspaceLinks account={account} address={address} workspaces={workspaces} />
							</>
						)}
						{addressError && (
							<>
								<MetaDot />
								<span className="text-destructive">Cannot read its address: {addressError}</span>
							</>
						)}
						{tools.toggle && (
							<>
								<MetaDot />
								{tools.toggle}
							</>
						)}
					</div>
				</div>
				{!signIn.waitingUrl && !removing && (
					<div className="flex shrink-0 items-center gap-1.5">
						<Reconnecting signIn={signIn} />
						<MoreActionsMenu name={shown} disabled={signIn.starting}>
							<ReconnectItem signIn={signIn} />
							<MenuSeparator />
							<MenuItem variant="destructive" onClick={() => setRemoving(true)}>
								<Trash2 />
								Remove
							</MenuItem>
						</MoreActionsMenu>
					</div>
				)}
			</div>
			<ConnectionCallout
				approveOn={label}
				signIn={signIn}
				question={
					removing && (
						<Confirm
							icon={Trash2}
							question={`Remove ${shown} from ${label}?`}
							detail={
								last
									? "omp signs out of it; its server stays in omp's mcp.json with your OAuth client, and its tools leave every omp session until you connect an account again."
									: "Its server and sign-in leave omp, and its tools leave every omp session."
							}
							confirm="Remove"
							run={async () => {
								await putJson<McpIntegration>("/api/integrations/remove", { id, account: name });
								await integrationsStore.refresh();
							}}
							onDone={() => setRemoving(false)}
						/>
					)
				}
				refused={connection.kind === "refused" ? { message: `${label} refused omp's sign-in to ${shown}. Reconnect to sign in again.` } : null}
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
			{children}
			{tools.list}
		</li>
	);
}

interface GoogleAccountsRowProps {
	integration: AccountsIntegration;
	/** The workspaces an account may be linked to; `null` where links are not edited, such as a page that offers to connect. */
	workspaces: Workspace[] | null;
	/** What shows once above the accounts, such as why none of their calendars could be listed. */
	notice?: ReactNode;
	/** What shows under each account, such as its calendars. */
	details?: (account: GoogleAccount) => ReactNode;
}

/**
 * A Google service whose accounts omp signs in to, each a server of its own: Set up until its OAuth client is saved,
 * then Add account, which lets you pick another Google account, and the accounts, each with its own controls.
 */
export function GoogleAccountsRow({ integration, workspaces, notice, details }: GoogleAccountsRowProps) {
	const { id, accounts, setup } = integration;
	const { label } = MCP_SERVICES[id];
	const service = SERVICES[id];
	const adding = useSignIn(integration.signIn?.account === null ? integration.signIn : null, integrationsStore.refresh, () => startSignIn(id, null));
	const [formOpen, setFormOpen] = useState(false);
	const connected = accounts.filter(account => signedIn(account.connection));
	const status: StatusLabel = adding.waitingUrl
		? WAITING_STATUS
		: !setup.configured && connected.length === 0
			? { label: "Not set up", color: "gray" }
			: connected.length === 0
				? STATUS[accounts[0]?.connection.kind ?? "absent"]
				: { label: connected.length === 1 ? "Connected" : `${connected.length} accounts`, color: "green" };
	const firstSignIn = connected.length === 0;

	let actions: ReactNode = null;
	if (!adding.waitingUrl && !formOpen) {
		actions = !setup.configured ? (
			<Button variant="secondary" size="compact" onClick={() => setFormOpen(true)}>
				Set up
			</Button>
		) : (
			<>
				<Button variant="secondary" size="compact" leadingIcon={firstSignIn ? undefined : Plus} loading={adding.starting} onClick={() => void adding.connect()}>
					{firstSignIn ? "Connect" : "Add account"}
				</Button>
				<MoreActionsMenu name={label} disabled={adding.starting}>
					<MenuItem onClick={() => setFormOpen(true)}>
						<KeyRound />
						Replace OAuth client
					</MenuItem>
				</MoreActionsMenu>
			</>
		);
	}

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
					{setup.configured ? <span className="font-mono">{MCP_SERVICES[id].host}</span> : <span>{service.client}</span>}
					{setup.configured && (
						<>
							<MetaDot />
							<span>
								callback <span className="font-mono">localhost:{setup.callbackPort}</span>
							</span>
						</>
					)}
				</>
			}
			actions={actions}
		>
			<ConnectionCallout approveOn={label} signIn={adding} question={null} refused={null} failing={null} />
			{formOpen && <GoogleClientForm id={id} setup={setup} connected={connected.length > 0} onDone={() => setFormOpen(false)} />}
			{connected.length > 0 && notice}
			{connected.length > 0 && (
				<ul aria-label={`${label} accounts`} className="divide-y divide-border rounded-lg bg-muted/40 px-3 py-3">
					{accounts.map(account => (
						<AccountRow key={account.name} integration={integration} account={account} last={accounts.length === 1} workspaces={workspaces}>
							{details?.(account)}
						</AccountRow>
					))}
				</ul>
			)}
		</IntegrationRow>
	);
}
