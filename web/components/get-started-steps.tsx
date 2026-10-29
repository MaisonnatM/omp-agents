/** The body of each Get started step: what it sets up, its live state, and the controls that set it up here. */
import { ArrowRight, Check, CircleAlert, Eye, GitPullRequest, type LucideIcon, Package, Plug, RefreshCw, SquareTerminal } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { providerConnected, type ProvidersAnswer } from "../../src/shared/providers";
import type { ProviderStatus } from "../../src/shared/source-control";
import type { StarterKitInstallResult } from "../../src/shared/desktop-bridge";
import type { CollabAutoStart, StarterKitStatus, TerminalAccess } from "../../src/shared/readiness";
import { activityControl, record } from "../activity";
import { appendToComposer, newDraftKey } from "../composer-drafts";
import type { Observation } from "../get-started-model";
import type { PolledEntry } from "../polled-store";
import { setTerminalAccess, starterKitStore } from "../reads";
import { useAction } from "../use-action";
import { CopyableCode } from "./copyable-code";
import { useDashboardActions } from "./dashboard-context";
import { Callout, IntegrationList, IntegrationRow, LIST_SURFACE, MarkTile } from "./integrations/integration-row";
import { LoadNote } from "./sheet-details";
import { ProviderGroups } from "./settings/providers-tab";

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

function DoneBadge({ done, need }: { done: boolean; need: Need }) {
	return (
		<Badge variant="dot" size="compact" color={done ? "green" : "gray"}>
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

/** Every provider omp can sign in to, signed in here, from the read Get started counts its connected providers in. */
export function ProviderStep({ providers: { read, error } }: { providers: PolledEntry<ProvidersAnswer> }) {
	const connected = read ? read.data.providers.filter(providerConnected).length : null;
	return (
		<div className="space-y-5">
			{connected !== null && connected > 0 && (
				<Callout tone="info" icon={Check}>
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

/**
 * Two cards that choose how sessions started in a terminal show here; off stays a choice of omp's own settings. Like
 * `QuestionOptions`, Tab enters the group at its checked card, else its first, arrows and Home and End move between
 * the cards, and Enter or Space picks one.
 */
export function TerminalStep({ terminal }: { terminal: Observation<CollabAutoStart> }) {
	const [choosing, setChoosing] = useState<TerminalAccess | null>(null);
	const cards = useRef<(HTMLButtonElement | null)[]>([]);
	const choose = useAction(async (access: TerminalAccess) => {
		setChoosing(access);
		try {
			await setTerminalAccess(access);
		} finally {
			setChoosing(null);
		}
	}, "Could not save how terminal sessions show");
	const shown = choosing ?? (terminal.kind === "known" ? terminal.value : null);
	const tabStop = Math.max(0, ACCESS.findIndex(({ value }) => value === shown));
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const from = cards.current.findIndex(card => card === document.activeElement);
		if (from === -1) return;
		let to: number;
		if (event.key === "Home") to = 0;
		else if (event.key === "End") to = ACCESS.length - 1;
		else if (event.key === "ArrowDown" || event.key === "ArrowRight") to = (from + 1) % ACCESS.length;
		else if (event.key === "ArrowUp" || event.key === "ArrowLeft") to = (from - 1 + ACCESS.length) % ACCESS.length;
		else return;
		event.preventDefault();
		cards.current[to]?.focus();
	};
	return (
		<div className="@container space-y-5">
			<div role="radiogroup" aria-label="Terminal session access" onKeyDown={onKeyDown} className="grid gap-3 @md:grid-cols-2">
				{ACCESS.map(({ value, title, summary, icon }, index) => {
					const selected = shown === value;
					return (
						<button
							key={value}
							ref={card => {
								cards.current[index] = card;
							}}
							type="button"
							role="radio"
							aria-checked={selected}
							tabIndex={index === tabStop ? 0 : -1}
							disabled={terminal.kind !== "known" || choose.pending}
							onClick={() => choose.run(value)}
							className={cn(
								"flex flex-col items-start gap-3 rounded-xl bg-surface-3 p-4 text-start shadow-surface-2 ring-1 transition-[box-shadow,background-color] duration-150 ease-out ring-inset hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default",
								selected ? "ring-foreground" : "ring-transparent",
							)}
						>
							<span className="flex w-full items-center justify-between">
								<MarkTile icon={icon} name={title} />
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

function kitMeta(kit: Observation<StarterKitStatus>): string | null {
	if (kit.kind === "checking") return "Checking this computer…";
	if (kit.kind === "unavailable") return null;
	const { pending, kept, total } = kit.value;
	if (pending > 0) return `${pending} of ${total} ${total === 1 ? "addition" : "additions"} still needed.`;
	return kept ? `Installed, with ${kept} of your customizations kept. New sessions load it.` : "Installed. New sessions load it.";
}

/** The starter kit's plan and its installer, which runs only through the desktop app. */
export function KitStep({ kit }: { kit: Observation<StarterKitStatus> }) {
	const [result, setResult] = useState<StarterKitInstallResult | null>(null);
	const run = window.ompDesktop?.installStarterKit;
	const install = useAction(async () => {
		if (!run) return;
		setResult(null);
		try {
			setResult(await run());
		} finally {
			await starterKitStore.refresh();
		}
	}, "Could not install the starter kit");
	const done = kit.kind === "known" && kit.value.pending === 0;
	return (
		<div className="space-y-5">
			<IntegrationList label="Starter kit">
				<IntegrationRow
					name="omp starter kit"
					mark={<MarkTile icon={Package} name="omp starter kit" />}
					status={<DoneBadge done={done} need="optional" />}
					summary="Workflows, extensions, model settings, and plugins. Files you changed stay as they are."
					meta={kitMeta(kit)}
					actions={
						!done && (
							<Button size="compact" loading={install.pending} disabled={install.pending || !run || kit.kind !== "known"} onClick={() => install.run()} {...activityControl("get-started.install-kit")}>
								Install
							</Button>
						)
					}
				>
					{!run && !done && <p className="text-xs text-muted-foreground">Open omp agents in the desktop app to install it.</p>}
					<Unavailable fact={kit} />
					{result && (
						<Callout tone={result.ok ? "info" : "danger"} icon={result.ok ? Check : CircleAlert} role="alert">
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

function githubMeta(github: Observation<ProviderStatus>): string | null {
	if (github.kind === "checking") return "Checking this computer…";
	if (github.kind === "unavailable") return null;
	const { state, account } = github.value;
	if (state === "missing") return "The GitHub CLI is not installed.";
	if (state === "signed-out") return "The GitHub CLI is installed and signed out.";
	return account ? `Signed in as ${account}` : "Signed in";
}

/** GitHub through its CLI, and the services in Integrations, each checked again when the window regains focus. */
export function ToolsStep({ github, integrations, onRefresh, refreshing }: { github: Observation<ProviderStatus>; integrations: Observation<number>; onRefresh: () => void; refreshing: boolean }) {
	const signedIn = github.kind === "known" && github.value.state === "signed-in";
	const connected = integrations.kind === "known" ? integrations.value : 0;
	return (
		<div className="space-y-5">
			<IntegrationList label="Your tools">
				<IntegrationRow
					name="GitHub"
					mark={<MarkTile icon={GitPullRequest} name="GitHub" />}
					status={<DoneBadge done={signedIn} need="optional" />}
					summary="Pull requests in the dashboard, and omp working on them."
					meta={githubMeta(github)}
					actions={
						github.kind === "known" &&
						github.value.state === "missing" && (
							<Button variant="secondary" size="compact" render={<a href="https://cli.github.com" target="_blank" rel="noreferrer" />} {...activityControl("get-started.install-gh")}>
								Install GitHub CLI
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
					mark={<MarkTile icon={Plug} name="Integrations" />}
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
				<Callout tone="info" icon={Check}>
					A session is already here. Start another whenever you like.
				</Callout>
			)}
			<ul aria-label="Suggested first tasks" className={LIST_SURFACE}>
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
