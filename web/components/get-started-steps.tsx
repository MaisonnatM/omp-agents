/** The body of each Get started step: what it sets up, its live state, and the controls that set it up here. */
import { ArrowRight, Check, CircleAlert, Eye, GitPullRequest, type LucideIcon, Package, Plug, RefreshCw, SquareTerminal } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { providerConnected } from "../../src/shared/providers";
import type { ProviderStatus } from "../../src/shared/source-control";
import type { StarterKitInstallResult } from "../../src/shared/desktop-bridge";
import type { CollabAutoStart, ReadinessFact, StarterKitStatus, TerminalAccess } from "../../src/shared/readiness";
import { errorText } from "../../src/json";
import { activityControl, record } from "../activity";
import { appendToComposer, newDraftKey } from "../composer-drafts";
import { readinessStore, shareTerminalSessions, starterKitStore } from "../reads";
import { useAction } from "../use-action";
import { CopyableCode } from "./copyable-code";
import { useDashboardActions } from "./dashboard-context";
import { Callout, IntegrationList, IntegrationRow } from "./integrations/integration-row";
import { LoadNote } from "./sheet-details";
import { ProviderGroups, useProviders } from "./settings/providers-tab";

export type Observation<T> = ReadinessFact<T> | { kind: "checking" };
export type Need = "required" | "recommended" | "optional";

export const NEED_LABEL: Record<Need, string> = { required: "Required", recommended: "Recommended", optional: "Optional" };

function Command({ value }: { value: string }) {
	return <CopyableCode value={value} label="Copy command" className="min-h-6 bg-surface-4 px-2 font-mono" onCopy={() => record("control", "get-started.copy-command")} />;
}

function Unavailable({ fact }: { fact: Observation<unknown> }) {
	if (fact.kind !== "unavailable") return null;
	return (
		<Callout tone="warning" icon={CircleAlert}>
			Cannot check this: {fact.message}
		</Callout>
	);
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
	return (
		<span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-5 text-muted-foreground shadow-surface-2">
			<Icon className="size-4" />
		</span>
	);
}

function DoneBadge({ done, need }: { done: boolean; need: Need }) {
	return (
		<Badge size="compact" color={done ? "green" : "gray"}>
			{done ? "Done" : NEED_LABEL[need]}
		</Badge>
	);
}

/** A step's title and what it gives you, the title labelling the step's region. */
export function StepHeader({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<header className="space-y-1.5">
			<h2 id={id} tabIndex={-1} className="text-lg font-semibold tracking-tight text-balance outline-none">
				{title}
			</h2>
			<p className="max-w-prose text-[13px] text-pretty text-muted-foreground">{children}</p>
		</header>
	);
}

/** Every provider omp can sign in to, signed in here; a change refreshes the readiness the rest of setup reads. */
export function ProviderStep() {
	const { read, error } = useProviders(true);
	const connected = read ? read.data.providers.filter(providerConnected).length : null;
	useEffect(() => {
		if (connected !== null) void readinessStore.refresh();
	}, [connected]);
	return (
		<div className="space-y-5">
			{connected !== null && connected > 0 && (
				<Callout tone="info" icon={Check} role="status">
					{connected === 1 ? "One provider is connected. Its models are ready for your first session." : `${connected} providers are connected. Their models are ready for your first session.`}
				</Callout>
			)}
			{read ? <ProviderGroups answer={read.data} /> : <LoadNote loading="Reading omp's providers…" error={error && `Cannot load the providers: ${error}`} />}
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span>Already using omp in a terminal? Sign in there instead with</span>
				<Command value="/login" />
			</div>
		</div>
	);
}

const ACCESS: readonly { value: TerminalAccess; title: string; summary: string; icon: LucideIcon }[] = [
	{ value: "control", title: "Control", summary: "Watch terminal sessions here and send them messages.", icon: SquareTerminal },
	{ value: "view", title: "Read-only", summary: "Watch terminal sessions here without sending them anything.", icon: Eye },
];

/** Two cards that choose how sessions started in a terminal show here; off stays a choice of omp's own settings. */
export function TerminalStep({ terminal }: { terminal: Observation<CollabAutoStart> }) {
	const [choosing, setChoosing] = useState<TerminalAccess | null>(null);
	const choose = useAction(async (access: TerminalAccess) => {
		setChoosing(access);
		try {
			await shareTerminalSessions(access);
		} finally {
			setChoosing(null);
		}
	}, "Could not save how terminal sessions show");
	const current = terminal.kind === "known" ? terminal.value : null;
	return (
		<div className="@container space-y-5">
			<div role="radiogroup" aria-label="Terminal session access" className="grid gap-3 @md:grid-cols-2">
				{ACCESS.map(({ value, title, summary, icon: Icon }) => {
					const selected = (choosing ?? current) === value;
					return (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={selected}
							disabled={terminal.kind !== "known" || choose.pending}
							onClick={() => choose.run(value)}
							className={cn(
								"flex flex-col items-start gap-3 rounded-xl bg-surface-3 p-4 text-start shadow-surface-2 ring-1 transition-[box-shadow,background-color] duration-150 ease-out ring-inset hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default",
								selected ? "ring-foreground" : "ring-transparent",
							)}
						>
							<span className="flex w-full items-center justify-between">
								<IconTile icon={Icon} />
								<span aria-hidden className={cn("flex size-4 items-center justify-center rounded-full ring-1 ring-border", selected && "bg-foreground ring-foreground")}>
									{selected && <span className="size-1.5 rounded-full bg-background" />}
								</span>
							</span>
							<span className="space-y-0.5">
								<span className="block text-[13px] font-medium">{title}</span>
								<span className="block text-[13px] text-pretty text-muted-foreground">{summary}</span>
							</span>
						</button>
					);
				})}
			</div>
			<Unavailable fact={terminal} />
			<p className="text-xs text-pretty text-muted-foreground">
				New terminal sessions follow this. One already running shows after you restart it, or run <code>/new</code> or <code>/collab</code> in it.
			</p>
		</div>
	);
}

/** The starter kit's plan and its installer, which runs only through the desktop app. */
export function KitStep({ kit }: { kit: Observation<StarterKitStatus> }) {
	const [result, setResult] = useState<StarterKitInstallResult | null>(null);
	const canInstall = Boolean(window.ompDesktop?.installStarterKit);
	const install = useAction(async () => {
		setResult(null);
		try {
			const run = window.ompDesktop?.installStarterKit;
			if (!run) throw new Error("Reopen this page in the current desktop app to install the starter kit.");
			setResult(await run());
		} catch (err) {
			setResult({ ok: false, message: errorText(err) });
		} finally {
			await starterKitStore.refresh();
		}
	}, "Could not install the starter kit");
	const done = kit.kind === "known" && kit.value.pending === 0;
	const meta = kit.kind === "known" ? (done ? `Installed${kit.value.kept ? `, with ${kit.value.kept} of your customizations kept` : ""}. New sessions load it.` : `${kit.value.pending} of ${kit.value.total} ${kit.value.total === 1 ? "addition" : "additions"} still needed.`) : kit.kind === "checking" ? "Checking this computer…" : null;
	return (
		<div className="space-y-5">
			<IntegrationList label="Starter kit">
				<IntegrationRow
					name="omp starter kit"
					mark={<IconTile icon={Package} />}
					status={<DoneBadge done={done} need="optional" />}
					summary="Workflows, extensions, model settings, and plugins. Files you changed stay as they are."
					meta={meta}
					actions={
						!done && (
							<Button size="compact" loading={install.pending} disabled={install.pending || !canInstall || kit.kind !== "known"} onClick={() => install.run()} {...activityControl("get-started.install-kit")}>
								Install
							</Button>
						)
					}
				>
					{!canInstall && !done && <p className="text-xs text-muted-foreground">Open omp agents in the desktop app to install it.</p>}
					<Unavailable fact={kit} />
					{result && (
						<Callout tone={result.ok ? "info" : "danger"} icon={result.ok ? Check : CircleAlert} role="status">
							<p>{result.ok ? "Installed. New sessions load its files and settings." : "Installation failed. You can try again."}</p>
							<details className="mt-1">
								<summary className="cursor-pointer">Installer output</summary>
								<pre className="mt-2 max-h-48 overflow-auto text-xs break-words whitespace-pre-wrap">{result.message}</pre>
							</details>
						</Callout>
					)}
				</IntegrationRow>
			</IntegrationList>
		</div>
	);
}

/** GitHub through its CLI, and the services in Integrations, each checked again when the window regains focus. */
export function ToolsStep({ github, integrations, onRefresh, refreshing }: { github: Observation<ProviderStatus>; integrations: Observation<number>; onRefresh: () => void; refreshing: boolean }) {
	const signedIn = github.kind === "known" && github.value.state === "signed-in";
	const connected = integrations.kind === "known" ? integrations.value : 0;
	const githubMeta = github.kind === "known" ? (signedIn ? `Signed in${github.value.account ? ` as ${github.value.account}` : ""}` : github.value.state === "missing" ? "The GitHub CLI is not installed." : "The GitHub CLI is installed and signed out.") : github.kind === "checking" ? "Checking this computer…" : null;
	return (
		<div className="space-y-5">
			<IntegrationList label="Your tools">
				<IntegrationRow
					name="GitHub"
					mark={<IconTile icon={GitPullRequest} />}
					status={<DoneBadge done={signedIn} need="optional" />}
					summary="Pull requests in the dashboard, and omp working on them."
					meta={githubMeta}
					actions={
						github.kind === "known" &&
						github.value.state === "missing" && (
							<Button variant="secondary" size="compact" render={<a href="https://cli.github.com" target="_blank" rel="noreferrer" />} {...activityControl("get-started.install-gh")}>
								Install gh
							</Button>
						)
					}
				>
					{github.kind === "known" && !signedIn && (
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>In your terminal:</span>
							<Command value="gh auth login" />
						</div>
					)}
					<Unavailable fact={github} />
				</IntegrationRow>
				<IntegrationRow
					name="Integrations"
					mark={<IconTile icon={Plug} />}
					status={<DoneBadge done={connected > 0} need="optional" />}
					summary="Linear, Slack, Gmail, and the other services omp can work in."
					meta={integrations.kind === "known" ? `${connected} ${connected === 1 ? "service" : "services"} connected` : integrations.kind === "checking" ? "Checking…" : null}
					actions={
						<Button variant="secondary" size="compact" render={<a href="#settings/integrations" />}>
							Open Integrations
						</Button>
					}
				>
					<Unavailable fact={integrations} />
				</IntegrationRow>
			</IntegrationList>
			<div className="flex justify-end">
				<Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={refreshing} onClick={onRefresh} {...activityControl("get-started.refresh")}>
					Check again
				</Button>
			</div>
		</div>
	);
}

const SUGGESTIONS: readonly { title: string; prompt: string }[] = [
	{ title: "Explain this codebase", prompt: "Explain how this codebase is organized, and where I should start reading." },
	{ title: "Fix a rough edge", prompt: "Find one small bug or rough edge in this project, fix it, and show me the change." },
	{ title: "Add missing tests", prompt: "Find the least-tested module in this project and add tests for its behavior." },
];

/** Suggested first tasks that open the new-session draft with their prompt, or a blank draft. */
export function SessionStep({ sessions }: { sessions: Observation<boolean> }) {
	const { openNewSession } = useDashboardActions();
	const start = (prompt: string): void => {
		appendToComposer(newDraftKey(null), prompt);
		openNewSession();
	};
	return (
		<div className="space-y-5">
			{sessions.kind === "known" && sessions.value && (
				<Callout tone="info" icon={Check} role="status">
					A session is already here. Start another whenever you like.
				</Callout>
			)}
			<ul aria-label="Suggested first tasks" className="divide-y divide-border overflow-hidden rounded-xl bg-surface-3 shadow-surface-2">
				{SUGGESTIONS.map(({ title, prompt }) => (
					<li key={title}>
						<button
							type="button"
							onClick={() => start(prompt)}
							{...activityControl("get-started.suggestion")}
							className="group flex w-full items-center gap-4 px-4 py-3.5 text-start transition-colors duration-150 ease-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
						>
							<span className="min-w-0 flex-1 space-y-0.5">
								<span className="block text-[13px] font-medium">{title}</span>
								<span className="block text-[13px] text-pretty text-muted-foreground">{prompt}</span>
							</span>
							<ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none" />
						</button>
					</li>
				))}
			</ul>
			<p className="text-xs text-pretty text-muted-foreground">Each one opens a new session with its prompt, where you pick the workspace and send it.</p>
			<Unavailable fact={sessions} />
		</div>
	);
}
