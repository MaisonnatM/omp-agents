import { ArrowLeft, ArrowRight, Check, CircleAlert, Plus } from "lucide-react";
import { useCallback, useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { connectionsOf, signedIn } from "../../src/shared/accounts";
import type { CollabAutoStart } from "../../src/shared/readiness";
import { activityControl } from "../activity";
import { SPLIT_CLICK } from "../labels";
import type { PolledEntry } from "../polled-store";
import { integrationsStore, readinessGithubStore, readinessStore, starterKitStore } from "../reads";
import { useStoredState } from "../stored-state";
import { useAction } from "../use-action";
import { useDashboardActions } from "./dashboard-context";
import { KitStep, NEED_LABEL, type Need, type Observation, ProviderStep, SessionStep, StepHeader, TerminalStep, ToolsStep } from "./get-started-steps";
import { Callout } from "./integrations/integration-row";

export const GET_STARTED_DISMISSED = "omp-agents.get-started-dismissed";
/** The step on screen, kept so leaving for Settings and coming back lands on the same step. */
const GET_STARTED_STEP = "omp-agents.get-started-step";

const STEPS = [
	{ id: "provider", label: "Model provider", need: "required", title: "Sign in to a model provider", summary: "omp needs a model to answer you. Connect a provider you already use, with its sign-in or an API key." },
	{ id: "terminal", label: "Terminal sessions", need: "recommended", title: "Show terminal sessions", summary: "omp sessions you start in a terminal can show here, next to the ones you start in the dashboard. Choose what the dashboard can do with them." },
	{ id: "kit", label: "Starter kit", need: "optional", title: "Install the starter kit", summary: "The setup this dashboard is built around, ready for every new session." },
	{ id: "tools", label: "GitHub and tools", need: "optional", title: "Connect your tools", summary: "Bring pull requests, tickets, and messages into the dashboard, so omp can work on them." },
	{ id: "session", label: "First session", need: "required", title: "Start your first session", summary: "Pick a first task for omp, or start from a blank prompt." },
] as const satisfies readonly { id: string; label: string; need: Need; title: string; summary: string }[];

type StepId = (typeof STEPS)[number]["id"];
type Place = "welcome" | StepId;

const isPlace = (raw: string | null): raw is Place => raw === "welcome" || STEPS.some(step => step.id === raw);
const CHECKING = { kind: "checking" } as const;

function observation<T>(entry: PolledEntry<T>): Observation<T> {
	if (entry.error) return { kind: "unavailable", message: entry.error };
	return entry.read ? { kind: "known", value: entry.read.data } : CHECKING;
}

const known = <T,>(fact: Observation<T>, done: (value: T) => boolean): boolean => fact.kind === "known" && done(fact.value);

function NeutralState({ live, rosterError, checking }: { live: boolean; rosterError: string | null; checking: boolean }) {
	const { openNewSession } = useDashboardActions();
	return (
		<Empty className="m-auto max-w-lg flex-none">
			<EmptyHeader>
				<EmptyTitle>{live ? "Select a session" : "No sessions are running"}</EmptyTitle>
				<EmptyDescription>{live ? `Choose a session to see its conversation. ${SPLIT_CLICK} more to see up to four side by side.` : "Start a session here, or return to setup whenever you need it."}</EmptyDescription>
			</EmptyHeader>
			<div className="flex flex-wrap justify-center gap-2">
				<Button size="compact" leadingIcon={Plus} onClick={() => openNewSession()}>
					New session
				</Button>
				<Button variant="secondary" size="compact" render={<a href="#get-started" />}>
					Get started
				</Button>
			</div>
			{checking && (
				<p role="status" className="text-xs text-muted-foreground">
					Checking setup on this computer…
				</p>
			)}
			{rosterError && (
				<Callout tone="warning" icon={CircleAlert}>
					Registry error: {rosterError}
				</Callout>
			)}
		</Empty>
	);
}

/** The app's mark, as `web/favicon.svg` draws it. */
function AppMark({ className }: { className: string }) {
	const gradient = useId();
	return (
		<svg aria-hidden viewBox="0 0 64 64" className={className}>
			<defs>
				<linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="oklch(0.7 0.24 340)" />
					<stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
					<stop offset="1" stopColor="oklch(0.81 0.14 200)" />
				</linearGradient>
			</defs>
			<path fill={`url(#${gradient})`} d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
		</svg>
	);
}

/** A step's number in its circle, or a check once it is done. */
function Marker({ index, done, current }: { index: number; done: boolean; current: boolean }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums ring-1 transition-colors duration-200 ease-out ring-inset",
				done ? "bg-green-500/15 text-green-700 ring-green-500/30 dark:text-green-400" : current ? "bg-foreground text-background ring-foreground" : "text-muted-foreground ring-border",
			)}
		>
			{done ? <Check className="size-3.5" /> : index + 1}
		</span>
	);
}

function Welcome({ titleId, done, onStart, onDismiss }: { titleId: string; done: Record<StepId, boolean>; onStart: () => void; onDismiss: () => void }) {
	return (
		<div className="m-auto flex w-full max-w-md flex-col items-center gap-7 py-10 text-center motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
			<AppMark className="size-12" />
			<div className="space-y-2">
				<h1 id={titleId} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-balance outline-none">
					Welcome to omp agents
				</h1>
				<p className="text-sm text-pretty text-muted-foreground">One place to start omp coding sessions, follow the ones in your terminals, and review what they did. Two steps are required; the rest can wait.</p>
			</div>
			<ol aria-label="Setup steps" className="w-full divide-y divide-border overflow-hidden rounded-xl bg-surface-3 text-start shadow-surface-2">
				{STEPS.map((step, index) => (
					<li key={step.id} className="flex items-center gap-3 px-4 py-2.5">
						<Marker index={index} done={done[step.id]} current={false} />
						<span className="min-w-0 flex-1 text-[13px]">{step.label}</span>
						<span className="text-xs text-muted-foreground">{done[step.id] ? "Done" : NEED_LABEL[step.need]}</span>
					</li>
				))}
			</ol>
			<div className="flex flex-wrap justify-center gap-2">
				<Button trailingIcon={ArrowRight} onClick={onStart} {...activityControl("get-started.next")}>
					Get started
				</Button>
				<Button variant="ghost" onClick={onDismiss} {...activityControl("get-started.dismiss")}>
					Skip setup
				</Button>
			</div>
		</div>
	);
}

/** Automatic setup never covers an open page or pane. Dismissal and the step on screen are stored on this origin alone; completion is read live. */
export function GetStarted({ mode, sessions, live, rosterError, sessionError, onClose }: {
	mode: "home" | "page";
	sessions: boolean | null;
	live: boolean;
	rosterError: string | null;
	sessionError: string | null;
	onClose: () => void;
}) {
	const { openNewSession } = useDashboardActions();
	const titleId = useId();
	const [dismissed, setDismissed] = useStoredState(GET_STARTED_DISMISSED, value => value === "true");
	const [place, setPlace] = useStoredState<Place>(GET_STARTED_STEP, raw => (isPlace(raw) ? raw : "welcome"));
	const core = readinessStore.use();
	const providers: Observation<number> = core.error ? { kind: "unavailable", message: core.error } : (core.read?.data.providers ?? CHECKING);
	const terminal: Observation<CollabAutoStart> = core.error ? { kind: "unavailable", message: core.error } : (core.read?.data.collabAutoStart ?? CHECKING);
	const firstSession: Observation<boolean> = sessions === true ? { kind: "known", value: true } : sessionError ? { kind: "unavailable", message: sessionError } : sessions === null ? CHECKING : { kind: "known", value: false };
	const requiredDone = known(providers, count => count > 0) && sessions === true;
	const checkingEntry = mode === "home" && !dismissed && !requiredDone && (providers.kind === "checking" || firstSession.kind === "checking");
	const visible = mode === "page" || (!dismissed && !requiredDone && !checkingEntry);
	const coreWanted = mode === "page" || (!dismissed && !requiredDone);
	useEffect(() => (coreWanted ? readinessStore.poll() : undefined), [coreWanted]);
	const github = observation(readinessGithubStore.usePolling(null, visible));
	const kit = observation(starterKitStore.usePolling(null, visible));
	const integrations = observation(integrationsStore.usePolling(null, visible));
	const integrationCount: Observation<number> = integrations.kind === "known" ? { kind: "known", value: Object.values(integrations.value.integrations).filter(item => connectionsOf(item).some(signedIn)).length } : integrations;

	const refresh = useCallback(async (): Promise<void> => {
		await Promise.all([readinessStore.refresh(), ...(visible ? [readinessGithubStore.refresh(), starterKitStore.refresh(), integrationsStore.refresh(null, { fresh: true })] : [])]);
	}, [visible]);
	useEffect(() => {
		if (!coreWanted && !visible) return;
		const focus = (): void => {
			if (!document.hidden) void refresh();
		};
		window.addEventListener("focus", focus);
		return () => window.removeEventListener("focus", focus);
	}, [coreWanted, visible, refresh]);
	const check = useAction(refresh, "Could not check setup");

	useEffect(() => {
		if (visible) document.getElementById(titleId)?.focus({ preventScroll: true });
	}, [place, titleId, visible]);

	if (!visible) return <NeutralState live={live} rosterError={rosterError} checking={checkingEntry} />;

	const done: Record<StepId, boolean> = {
		provider: known(providers, count => count > 0),
		terminal: known(terminal, value => value !== "off"),
		kit: known(kit, value => value.pending === 0),
		tools: known(github, value => value.state === "signed-in") || known(integrationCount, count => count > 0),
		session: sessions === true,
	};
	const dismiss = (): void => {
		setDismissed(true);
		if (mode === "page") onClose();
	};

	if (place === "welcome") {
		return (
			<section aria-labelledby={titleId} className="flex min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
				<Welcome titleId={titleId} done={done} onStart={() => setPlace(STEPS.find(step => !done[step.id])?.id ?? "provider")} onDismiss={dismiss} />
			</section>
		);
	}

	const index = STEPS.findIndex(step => step.id === place);
	const step = STEPS[index]!;
	const next = STEPS[index + 1];
	const requiredCount = STEPS.filter(item => item.need === "required").length;
	const requiredFinished = STEPS.filter(item => item.need === "required" && done[item.id]).length;
	const body = {
		provider: <ProviderStep />,
		terminal: <TerminalStep terminal={terminal} />,
		kit: <KitStep kit={kit} />,
		tools: <ToolsStep github={github} integrations={integrationCount} onRefresh={() => check.run()} refreshing={check.pending} />,
		session: <SessionStep sessions={firstSession} />,
	}[step.id];
	const forward = next ? (
		done[step.id] ? (
			<Button trailingIcon={ArrowRight} onClick={() => setPlace(next.id)} {...activityControl("get-started.next")}>
				Next: {next.label}
			</Button>
		) : (
			<Button variant="secondary" onClick={() => setPlace(next.id)} {...activityControl("get-started.skip")}>
				Skip for now
			</Button>
		)
	) : done[step.id] ? (
		<Button onClick={dismiss} {...activityControl("get-started.dismiss")}>
			Finish setup
		</Button>
	) : (
		<Button leadingIcon={Plus} onClick={() => openNewSession()}>
			New session
		</Button>
	);

	return (
		<section aria-labelledby={titleId} className="@container/get-started flex min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
			<div className="m-auto flex h-full max-h-[46rem] min-h-[32rem] w-full max-w-4xl overflow-hidden rounded-2xl bg-surface-2 shadow-surface-2 ring-1 ring-border">
				<nav aria-label="Setup steps" className="hidden w-60 shrink-0 flex-col gap-6 border-e border-border bg-surface-1 p-4 @2xl/get-started:flex">
					<div className="flex items-center gap-2.5 px-2 pt-1">
						<AppMark className="size-5 shrink-0" />
						<div className="min-w-0">
							<p className="text-[13px] font-medium">Set up omp agents</p>
							<p className="text-xs text-muted-foreground tabular-nums">
								{requiredFinished} of {requiredCount} required done
							</p>
						</div>
					</div>
					<ol className="space-y-0.5">
						{STEPS.map((item, position) => (
							<li key={item.id}>
								<button
									type="button"
									aria-current={item.id === place ? "step" : undefined}
									onClick={() => setPlace(item.id)}
									{...activityControl("get-started.step")}
									className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors duration-150 ease-out hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=step]:bg-active"
								>
									<Marker index={position} done={done[item.id]} current={item.id === place} />
									<span className="min-w-0">
										<span className="block truncate text-[13px]">{item.label}</span>
										<span className="block text-xs text-muted-foreground">{done[item.id] ? "Done" : NEED_LABEL[item.need]}</span>
									</span>
								</button>
							</li>
						))}
					</ol>
					<Button variant="ghost" size="compact" className="mt-auto self-start" onClick={dismiss} {...activityControl("get-started.dismiss")}>
						Skip setup
					</Button>
				</nav>
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center justify-between gap-3 px-8 pt-6">
						<p className="text-xs text-muted-foreground tabular-nums">
							Step {index + 1} of {STEPS.length}
						</p>
						<Button variant="ghost" size="compact" className="@2xl/get-started:hidden" onClick={dismiss} {...activityControl("get-started.dismiss")}>
							Skip setup
						</Button>
					</div>
					<div key={step.id} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-8 pt-3 pb-6 motion-safe:animate-in motion-safe:duration-200 motion-safe:ease-out motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
						<StepHeader id={titleId} title={step.title}>
							{step.summary}
						</StepHeader>
						{rosterError && (
							<Callout tone="warning" icon={CircleAlert}>
								Registry error: {rosterError}
							</Callout>
						)}
						{body}
					</div>
					<footer className="flex items-center gap-2 border-t border-border px-8 py-4">
						<Button variant="ghost" leadingIcon={ArrowLeft} onClick={() => setPlace(index === 0 ? "welcome" : STEPS[index - 1]!.id)} {...activityControl("get-started.back")}>
							Back
						</Button>
						<div className="ms-auto flex items-center gap-2">{forward}</div>
					</footer>
				</div>
			</div>
		</section>
	);
}
