import { Check, CircleAlert, GitPullRequest, KeyRound, LoaderCircle, type LucideIcon, Package, Plug, Plus, RefreshCw, Terminal } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { connectionsOf, signedIn } from "../../src/shared/accounts";
import type { StarterKitInstallResult } from "../../src/shared/desktop-bridge";
import type { CollabAutoStart, ReadinessFact } from "../../src/shared/readiness";
import { errorText } from "../../src/json";
import { activityControl, record } from "../activity";
import { SPLIT_CLICK } from "../labels";
import type { PolledEntry } from "../polled-store";
import { integrationsStore, readinessGithubStore, readinessStore, showTerminalSessions, starterKitStore } from "../reads";
import { useStoredState } from "../stored-state";
import { useAction } from "../use-action";
import { CopyableCode } from "./copyable-code";
import { useDashboardActions } from "./dashboard-context";
import { Callout, IntegrationList, IntegrationRow } from "./integrations/integration-row";

export const GET_STARTED_DISMISSED = "omp-agents.get-started-dismissed";

type Observation<T> = ReadinessFact<T> | { kind: "checking" };
type Progress = { kind: "checking" } | { kind: "known"; done: boolean; detail: string } | { kind: "unavailable"; message: string };
type Need = "required" | "recommended" | "optional";
interface Step {
	id: "provider" | "first-session" | "terminal-sessions" | "github" | "starter-kit" | "integrations";
	need: Need;
	title: string;
	summary: string;
	icon: LucideIcon;
	progress: Progress;
	action: ReactNode;
	extra?: ReactNode;
}

const CHECKING = { kind: "checking" } as const;
const isDone = (progress: Progress): boolean => progress.kind === "known" && progress.done;

function observation<T>(entry: PolledEntry<T>): Observation<T> {
	if (entry.error) return { kind: "unavailable", message: entry.error };
	return entry.read ? { kind: "known", value: entry.read.data } : CHECKING;
}

function progress<T>(fact: Observation<T>, done: (value: T) => boolean, detail: (value: T) => string): Progress {
	return fact.kind === "known" ? { kind: "known", done: done(fact.value), detail: detail(fact.value) } : fact;
}

function Command({ value }: { value: string }) {
	return <CopyableCode value={value} label="Copy command" className="min-h-6 bg-surface-4 px-2 font-mono" onCopy={() => record("control", "get-started.copy-command")} />;
}

function StepRow({ step }: { step: Step }) {
	const done = isDone(step.progress);
	const Icon = done ? Check : step.progress.kind === "checking" ? LoaderCircle : step.icon;
	const label = done ? "Done" : step.progress.kind === "checking" ? "Checking" : step.progress.kind === "unavailable" ? "Check unavailable" : { required: "Required", recommended: "Recommended", optional: "Optional" }[step.need];
	return (
		<IntegrationRow
			name={step.title}
			mark={<span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-5 text-muted-foreground shadow-surface-2"><Icon className={`size-4 ${step.progress.kind === "checking" ? "motion-safe:animate-spin" : ""}`} /></span>}
			status={<Badge size="compact" color={done ? "green" : "gray"}>{label}</Badge>}
			summary={step.summary}
			meta={step.progress.kind === "known" ? step.progress.detail : step.progress.kind === "checking" ? "Checking this computer…" : "Use Check again after fixing the connection."}
			actions={step.action}
		>
			{step.progress.kind === "unavailable" && <Callout tone="warning" icon={CircleAlert}>{step.progress.message}</Callout>}
			{step.extra}
		</IntegrationRow>
	);
}

function NeutralState({ live, rosterError, checking }: { live: boolean; rosterError: string | null; checking: boolean }) {
	const { openNewSession } = useDashboardActions();
	return (
		<Empty className="m-auto max-w-lg flex-none">
			<EmptyHeader>
				<EmptyTitle>{live ? "Select a session" : "No sessions are running"}</EmptyTitle>
				<EmptyDescription>{live ? `Choose a session to see its conversation. ${SPLIT_CLICK} more to see up to four side by side.` : "Start a session here, or return to setup whenever you need it."}</EmptyDescription>
			</EmptyHeader>
			<div className="flex flex-wrap justify-center gap-2">
				<Button size="compact" leadingIcon={Plus} onClick={() => openNewSession()}>New session</Button>
				<Button variant="secondary" size="compact" render={<a href="#get-started" />}>Get started</Button>
			</div>
			{checking && <p role="status" className="text-xs text-muted-foreground">Checking setup on this computer…</p>}
			{rosterError && <Callout tone="warning" icon={CircleAlert}>Registry error: {rosterError}</Callout>}
		</Empty>
	);
}

/** Automatic setup never covers an open page or pane. Only dismissal is stored, on this origin alone. */
export function GetStarted({ mode, sessions, live, rosterError, sessionError, onClose }: {
	mode: "home" | "page";
	sessions: boolean | null;
	live: boolean;
	rosterError: string | null;
	sessionError: string | null;
	onClose: () => void;
}) {
	const { openNewSession } = useDashboardActions();
	const [dismissed, setDismissed] = useStoredState(GET_STARTED_DISMISSED, value => value === "true");
	const core = readinessStore.use();
	const providers: Observation<number> = core.error ? { kind: "unavailable", message: core.error } : core.read?.data.providers ?? CHECKING;
	const terminal: Observation<CollabAutoStart> = core.error ? { kind: "unavailable", message: core.error } : core.read?.data.collabAutoStart ?? CHECKING;
	const firstSession: Observation<boolean> = sessions === true ? { kind: "known", value: true } : sessionError ? { kind: "unavailable", message: sessionError } : sessions === null ? CHECKING : { kind: "known", value: false };
	const requiredDone = providers.kind === "known" && providers.value > 0 && sessions === true;
	const checkingEntry = mode === "home" && !dismissed && !requiredDone && (providers.kind === "checking" || firstSession.kind === "checking");
	const visible = mode === "page" || (!dismissed && !requiredDone && !checkingEntry);
	const coreWanted = mode === "page" || (!dismissed && !requiredDone);
	useEffect(() => coreWanted ? readinessStore.poll() : undefined, [coreWanted]);
	const github = observation(readinessGithubStore.usePolling(null, visible));
	const kit = observation(starterKitStore.usePolling(null, visible));
	const integrations = observation(integrationsStore.usePolling(null, visible));
	const integrationCount: Observation<number> = integrations.kind === "known" ? { kind: "known", value: Object.values(integrations.value.integrations).filter(item => connectionsOf(item).some(signedIn)).length } : integrations;
	const [installResult, setInstallResult] = useState<StarterKitInstallResult | null>(null);

	const refresh = useCallback(async (): Promise<void> => {
		await Promise.all([
			readinessStore.refresh(),
			...(visible ? [readinessGithubStore.refresh(), starterKitStore.refresh(), integrationsStore.refresh(null, { fresh: true })] : []),
		]);
	}, [visible]);
	useEffect(() => {
		if (!coreWanted && !visible) return;
		const focus = (): void => { if (!document.hidden) void refresh(); };
		window.addEventListener("focus", focus);
		return () => window.removeEventListener("focus", focus);
	}, [coreWanted, visible, refresh]);
	const check = useAction(refresh, "Could not check setup");
	const turnOn = useAction(showTerminalSessions, "Could not show terminal sessions");
	const install = useAction(async () => {
		setInstallResult(null);
		try {
			const run = window.ompDesktop?.installStarterKit;
			if (!run) throw new Error("Reopen this page in the current desktop app to install the starter kit.");
			setInstallResult(await run());
		} catch (err) {
			setInstallResult({ ok: false, message: errorText(err) });
		} finally {
			await starterKitStore.refresh();
		}
	}, "Could not install the starter kit");

	if (!visible) return <NeutralState live={live} rosterError={rosterError} checking={checkingEntry} />;
	const dismiss = (): void => {
		setDismissed(true);
		if (mode === "page") onClose();
	};
	const providerProgress = progress(providers, count => count > 0, count => count > 0 ? `${count} model ${count === 1 ? "provider" : "providers"} connected` : "Sign in here, or run /login in omp's terminal.");
	const terminalProgress = progress(terminal, value => value === "control" || value === "view", value => value === "off" ? "New terminal sessions are not shared yet." : `Terminal sessions open with ${value === "view" ? "read-only" : "control"} access.`);
	const steps: readonly Step[] = [
		{
			id: "provider", need: "required", title: "Sign in to a model provider", icon: KeyRound,
			summary: "Connect a provider so omp can answer your first message.", progress: providerProgress,
			action: <Button variant={isDone(providerProgress) ? "secondary" : "primary"} size="compact" render={<a href="#settings/providers" />}>Providers</Button>,
			extra: !isDone(providerProgress) && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Already using omp in a terminal?</span><Command value="/login" /></div>,
		},
		{
			id: "first-session", need: "required", title: "Start your first session", icon: Plus,
			summary: "Pick a workspace and send omp something to work on.",
			progress: progress(firstSession, value => value, value => value ? "A live or past session is already here." : "Sending the first message starts the session."),
			action: <Button variant={isDone(providerProgress) && sessions !== true ? "primary" : "secondary"} size="compact" onClick={() => openNewSession()}>New session</Button>,
		},
		{
			id: "terminal-sessions", need: "recommended", title: "Show terminal sessions", icon: Terminal,
			summary: "See sessions you start in a terminal alongside the ones you start here.", progress: terminalProgress,
			action: !isDone(terminalProgress) && <Button variant="secondary" size="compact" loading={turnOn.pending} disabled={turnOn.pending || terminal.kind !== "known"} onClick={() => turnOn.run()}>Turn on</Button>,
			extra: <p className="text-xs text-muted-foreground">Already running? Restart the terminal session, or run <code>/new</code> or <code>/collab</code> in it.</p>,
		},
		{
			id: "github", need: "optional", title: "Connect GitHub", icon: GitPullRequest,
			summary: "Bring pull requests into the dashboard and let omp work on them.",
			progress: progress(github, value => value.state === "signed-in", value => value.state === "signed-in" ? `Signed in${value.account ? ` as ${value.account}` : ""}` : value.state === "missing" ? "Install the GitHub CLI, then sign in from your terminal." : "Sign in to the GitHub CLI from your terminal."),
			action: github.kind === "known" && github.value.state === "missing" && <Button variant="secondary" size="compact" render={<a href="https://cli.github.com" target="_blank" rel="noreferrer" />} {...activityControl("get-started.install-gh")}>Install gh</Button>,
			extra: github.kind === "known" && github.value.state !== "signed-in" && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>In your terminal:</span><Command value="gh auth login" /></div>,
		},
		{
			id: "starter-kit", need: "optional", title: "Install the starter kit", icon: Package,
			summary: "Add the shared workflows, extensions, and model settings. Your customizations stay.",
			progress: progress(kit, value => value.pending === 0, value => value.pending === 0 ? `Installed${value.kept ? `, with ${value.kept} of your customizations kept` : ""}. New sessions load it.` : `${value.pending} ${value.pending === 1 ? "addition" : "additions"} still needed, including files, settings, and plugins.`),
			action: !(kit.kind === "known" && kit.value.pending === 0) && <Button variant="secondary" size="compact" loading={install.pending} disabled={install.pending || !window.ompDesktop?.installStarterKit} onClick={() => install.run()} {...activityControl("get-started.install-kit")}>Install</Button>,
			extra: <>{!window.ompDesktop?.installStarterKit && <p className="text-xs text-muted-foreground">Use the current desktop app to install the starter kit.</p>}{installResult && <Callout tone={installResult.ok ? "info" : "danger"} icon={installResult.ok ? Check : CircleAlert} role="status"><p>{installResult.ok ? "Installer finished. New sessions load installed files and settings." : "Installation failed. You can try again."}</p><details className="mt-1"><summary className="cursor-pointer">Installer output</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{installResult.message}</pre></details></Callout>}</>,
		},
		{
			id: "integrations", need: "optional", title: "Connect integrations", icon: Plug,
			summary: "Give omp access to the services you work in, such as Linear, Slack, and Gmail.",
			progress: progress(integrationCount, count => count > 0, count => `${count} ${count === 1 ? "service" : "services"} connected`),
			action: <Button variant="secondary" size="compact" render={<a href="#settings/integrations" />}>Integrations</Button>,
		},
	];
	const finished = steps.filter(step => step.need === "required" && isDone(step.progress)).length;
	return (
		<section aria-labelledby="get-started-title" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5"><h1 id="get-started-title" className="text-xl font-semibold tracking-tight">Get started</h1><p className="text-sm text-pretty text-muted-foreground">Connect a provider, then give omp its first task.</p></div>
					<Button variant="ghost" size="compact" onClick={dismiss} {...activityControl("get-started.dismiss")}>Dismiss</Button>
				</div>
				{rosterError && <Callout tone="warning" icon={CircleAlert}>Registry error: {rosterError}</Callout>}
					<div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-medium">Your first session</h2><span role="status" className="text-xs tabular-nums text-muted-foreground">{finished} of 2 required steps done</span></div><IntegrationList label="Your first session">{steps.filter(step => step.need === "required").map(step => <StepRow key={step.id} step={step} />)}</IntegrationList></div>
					<div className="space-y-3"><h2 className="text-sm font-medium">Make it yours</h2><IntegrationList label="Make it yours">{steps.filter(step => step.need !== "required").map(step => <StepRow key={step.id} step={step} />)}</IntegrationList></div>
				<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>Steps check themselves. Dismissal stays on this computer.</p><Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={check.pending} onClick={() => check.run()} {...activityControl("get-started.refresh")}>Check again</Button></div>
			</div>
		</section>
	);
}
