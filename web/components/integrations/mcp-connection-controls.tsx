/**
 * What Settings › Integrations' MCP rows and Settings › MCP servers' rows share about a remote MCP connection: its
 * status labels, the Connect button and Reconnect and Sign out items, the callout that says where the connection stands,
 * the sign-out question, and the tool list.
 */
import { ChevronRight, CircleAlert, ExternalLink, LoaderCircle, LogOut, RefreshCw, WifiOff } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { McpRemoteStatus, McpTool } from "../../../src/shared/mcp-status";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { errorText } from "../../../src/json";
import type { SignInControls } from "../../use-sign-in";
import { Callout } from "./integration-row";

export interface StatusLabel {
	label: string;
	color: BadgeColor;
}

/** The badge of each remote status, which each section extends with the kinds only it reaches. */
export const REMOTE_STATUS: Record<McpRemoteStatus["kind"], StatusLabel> = {
	"signed-out": { label: "Signed out", color: "gray" },
	ready: { label: "Connected", color: "green" },
	refused: { label: "Needs reconnecting", color: "red" },
	failing: { label: "Unreachable", color: "amber" },
};

/** The badge while a sign-in waits on you in the provider's tab, which wins over the status last read. */
export const WAITING_STATUS: StatusLabel = { label: "Waiting for you", color: "blue" };

export const StatusBadge = ({ label, color }: StatusLabel) => (
	<Badge variant="dot" size="compact" color={color}>
		{label}
	</Badge>
);

/** Connect, for a server omp holds no sign-in to. */
export const ConnectButton = ({ signIn }: { signIn: SignInControls }) => (
	<Button variant="secondary" size="compact" loading={signIn.starting} onClick={() => void signIn.connect()}>
		Connect
	</Button>
);

/** The note beside a signed-in row's menu while a reconnect starts. */
export const Reconnecting = ({ signIn }: { signIn: SignInControls }) =>
	signIn.starting && (
		<span role="status" aria-busy className="flex items-center gap-1.5 text-xs text-muted-foreground">
			<LoaderCircle aria-hidden className="size-3.5 animate-spin" />
			Reconnecting…
		</span>
	);

/** The menu item that signs in again over the sign-in omp holds. */
export const ReconnectItem = ({ signIn }: { signIn: SignInControls }) => (
	<MenuItem onClick={() => void signIn.connect()}>
		<RefreshCw />
		Reconnect
	</MenuItem>
);

/** The menu item that opens the {@link SignOutConfirm} question. */
export const SignOutItem = ({ destructive = false, onClick }: { destructive?: boolean; onClick: () => void }) => (
	<MenuItem variant={destructive ? "destructive" : undefined} onClick={onClick}>
		<LogOut />
		Sign out
	</MenuItem>
);

interface ConfirmProps {
	icon: typeof LogOut;
	question: string;
	detail: string;
	confirm: string;
	run: () => Promise<void>;
	onDone: () => void;
}

/** Asks `question` before `run`; a failure stays in the question, to try again or cancel. */
export function Confirm({ icon, question, detail, confirm, run, onDone }: ConfirmProps) {
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

/** Asks before `signOut` signs omp out of `name`, which answers once the row has read where omp stands again. */
export const SignOutConfirm = ({ name, signOut, onDone }: { name: string; signOut: () => Promise<void>; onDone: () => void }) => (
	<Confirm icon={LogOut} question={`Sign omp out of ${name}?`} detail="Its tools leave every omp session until you reconnect." confirm="Sign out" run={signOut} onDone={onDone} />
);

export interface ConnectionCalloutProps {
	/** What the waiting sign-in asks you to approve omp on. */
	approveOn: string;
	signIn: SignInControls;
	/** The row's open question, such as its {@link SignOutConfirm}, or `null`. */
	question: ReactNode;
	/** A failure of the row's own change, shown after a sign-in failure. */
	error?: string | null;
	/** Why the server refused omp's sign-in, with the button that fixes it, Reconnect unless `fix` names another; `null` unless it did. */
	refused: { message: ReactNode; fix?: ReactNode } | null;
	/** Why the server cannot be reached, with `check` re-reading it fresh after any `fix`; `null` unless it cannot. */
	failing: { message: ReactNode; checking: boolean; check: () => void; fix?: ReactNode } | null;
}

/** The one callout under a row: a waiting sign-in, then the row's question, a failure, a refused sign-in, and an unreachable server. */
export function ConnectionCallout({ approveOn, signIn, question, error, refused, failing }: ConnectionCalloutProps) {
	if (signIn.waitingUrl) {
		return (
			<Callout
				tone="info"
				icon={LoaderCircle}
				role="status"
				spin
				action={
					<Button variant="ghost" size="compact" leadingIcon={ExternalLink} render={<a href={signIn.waitingUrl} target="_blank" rel="noreferrer" />}>
						Open sign-in page
					</Button>
				}
			>
				Approve omp on {approveOn} in the tab that opened. This updates on its own.
			</Callout>
		);
	}
	if (question) return question;
	if (signIn.failure || error) {
		return (
			<Callout tone="danger" icon={CircleAlert} role="alert">
				{signIn.failure ? `Sign-in failed: ${signIn.failure}` : error}
			</Callout>
		);
	}
	if (refused) {
		return (
			<Callout
				tone="danger"
				icon={CircleAlert}
				action={
					refused.fix ?? (
						<Button variant="secondary" size="compact" leadingIcon={RefreshCw} loading={signIn.starting} onClick={() => void signIn.connect()}>
							Reconnect
						</Button>
					)
				}
			>
				{refused.message}
			</Callout>
		);
	}
	if (failing) {
		return (
			<Callout
				tone="warning"
				icon={WifiOff}
				action={
					<div className="flex items-center gap-2">
						{failing.fix}
						<Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={failing.checking} onClick={failing.check}>
							Check again
						</Button>
					</div>
				}
			>
				{failing.message}
			</Callout>
		);
	}
	return null;
}

interface ReadyTools {
	tools: readonly McpTool[];
	/** The server the tools come from, by its name in omp's config and its address. */
	server: { name: string; url: string };
}

/** The tools omp sessions can call, sorted for scanning, each description on hover, and the server they come from. */
function ToolList({ id, tools, server }: ReadyTools & { id: string }) {
	return (
		<div id={id} className="rounded-lg bg-muted/60 p-3">
			<ul aria-label="Tools" className="grid max-h-60 grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto font-mono text-xs text-muted-foreground sm:grid-cols-2">
				{tools.toSorted((a, b) => a.name.localeCompare(b.name)).map(tool => (
					<li key={tool.name} className="truncate" title={tool.description ? `${tool.name}: ${tool.description}` : tool.name}>
						{tool.name}
					</li>
				))}
			</ul>
			<p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
				From omp's <code className="font-mono text-foreground">{server.name}</code> MCP server at <span className="font-mono">{server.url}</span>
			</p>
		</div>
	);
}

/**
 * A ready server's tools: `toggle`, the meta fact that counts them and opens them, and `list`, the {@link ToolList} while
 * open; both `null` while `ready` is `null`, for a server that is not ready.
 */
export function useToolList(ready: ReadyTools | null): { toggle: ReactNode; list: ReactNode } {
	const [open, setOpen] = useState(false);
	const id = useId();
	if (ready === null) return { toggle: null, list: null };
	return {
		toggle: (
			<button
				type="button"
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				onClick={() => setOpen(was => !was)}
				className="-mx-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
			>
				<span className="tabular-nums">{ready.tools.length}</span> tools
				<ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150 ease-out", open && "rotate-90")} />
			</button>
		),
		list: open && <ToolList id={id} tools={ready.tools} server={ready.server} />,
	};
}
