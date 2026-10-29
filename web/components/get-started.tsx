import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Plus, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
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

const GET_STARTED_DISMISSED = "omp-agents.get-started-dismissed";
/** Set once the dialog is closed, so a vacant home shows the bubble instead of opening the dialog again. */
const GET_STARTED_MINIMIZED = "omp-agents.get-started-minimized";
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
const REQUIRED_COUNT = STEPS.filter(item => item.need === "required").length;

function observation<T>(entry: PolledEntry<T>): Observation<T> {
	if (entry.error) return { kind: "unavailable", message: entry.error };
	return entry.read ? { kind: "known", value: entry.read.data } : CHECKING;
}

const known = <T,>(fact: Observation<T>, done: (value: T) => boolean): boolean => fact.kind === "known" && done(fact.value);

/** The main area when no session or page shows. */
export function EmptyHome({ live, rosterError }: { live: boolean; rosterError: string | null }) {
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

/** How many of the steps are done, as a ring that fills. */
function ProgressRing({ done, total }: { done: number; total: number }) {
	const circumference = 2 * Math.PI * 8;
	return (
		<svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 -rotate-90">
			<circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" className="stroke-border" />
			<circle
				cx="10"
				cy="10"
				r="8"
				fill="none"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray={circumference}
				strokeDashoffset={circumference * (1 - done / total)}
				className="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
			/>
		</svg>
	);
}

function CloseButton() {
	return (
		<Tooltip content="Close" shortcut={["Esc"]} side="bottom">
			<DialogPrimitive.Close asChild>
				<Button variant="ghost" size="icon-compact" aria-label="Close" {...activityControl("get-started.close")}>
					<X />
				</Button>
			</DialogPrimitive.Close>
		</Tooltip>
	);
}

function Welcome({ titleId, done, onStart, onDismiss }: { titleId: string; done: Record<StepId, boolean>; onStart: () => void; onDismiss: () => void }) {
	return (
		<div className="relative flex min-h-0 flex-1 overflow-y-auto p-6">
			<div className="absolute end-3 top-3">
				<CloseButton />
			</div>
			<div className="m-auto flex w-full max-w-md flex-col items-center gap-7 py-6 text-center motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
				<AppMark className="size-12" />
				<div className="space-y-2">
					<h2 id={titleId} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-balance outline-none">
						Welcome to omp agents
					</h2>
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
		</div>
	);
}

/** The closed dialog, at the bottom right of the window until setup is done or skipped. */
function Bubble({ finished, onDismiss }: { finished: number; onDismiss: () => void }) {
	return (
		<div className="fixed end-4 bottom-10 z-30 flex items-center gap-0.5 rounded-full bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-border motion-safe:animate-in motion-safe:duration-300 motion-safe:ease-out motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2">
			<a
				href="#get-started"
				{...activityControl("get-started.bubble")}
				className="flex items-center gap-2.5 rounded-full py-1.5 ps-2 pe-3 transition-colors duration-150 ease-out hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
			>
				<ProgressRing done={finished} total={REQUIRED_COUNT} />
				<span className="text-[13px] font-medium">Get started</span>
				<span className="text-xs text-muted-foreground tabular-nums">
					{finished} of {REQUIRED_COUNT} required done
				</span>
			</a>
			<Tooltip content="Skip setup">
				<Button variant="ghost" size="icon-compact" className="rounded-full" aria-label="Skip setup" onClick={onDismiss} {...activityControl("get-started.dismiss")}>
					<X />
				</Button>
			</Tooltip>
		</div>
	);
}

/**
 * Setup in a dialog, open at `#get-started` and once on a vacant first-run home; closed, it waits in a bubble at the
 * bottom right until the required steps are done or setup is skipped. Dismissal, the closed dialog, and the step on
 * screen are stored on this origin alone; completion is read live.
 */
export function GetStarted({ route, vacantHome, sessions, rosterError, sessionError, onClose }: {
	/** The URL names `#get-started`. */
	route: boolean;
	/** No page or pane shows, so the dialog may open on its own. */
	vacantHome: boolean;
	sessions: boolean | null;
	rosterError: string | null;
	sessionError: string | null;
	/** Leaves `#get-started`. */
	onClose: () => void;
}) {
	const { openNewSession } = useDashboardActions();
	const titleId = useId();
	const [dismissed, setDismissed] = useStoredState(GET_STARTED_DISMISSED, value => value === "true");
	const [minimized, setMinimized] = useStoredState(GET_STARTED_MINIMIZED, value => value === "true");
	const [place, setPlace] = useStoredState<Place>(GET_STARTED_STEP, raw => (isPlace(raw) ? raw : "welcome"));
	const core = readinessStore.use();
	const providers: Observation<number> = core.error ? { kind: "unavailable", message: core.error } : (core.read?.data.providers ?? CHECKING);
	const terminal: Observation<CollabAutoStart> = core.error ? { kind: "unavailable", message: core.error } : (core.read?.data.collabAutoStart ?? CHECKING);
	const firstSession: Observation<boolean> = sessions === true ? { kind: "known", value: true } : sessionError ? { kind: "unavailable", message: sessionError } : sessions === null ? CHECKING : { kind: "known", value: false };
	const requiredDone = known(providers, count => count > 0) && sessions === true;
	const pending = !dismissed && !requiredDone;
	const settled = providers.kind !== "checking" && firstSession.kind !== "checking";
	const open = route || (pending && settled && vacantHome && !minimized);
	useEffect(() => (open || pending ? readinessStore.poll() : undefined), [open, pending]);
	const github = observation(readinessGithubStore.usePolling(null, open));
	const kit = observation(starterKitStore.usePolling(null, open));
	const integrations = observation(integrationsStore.usePolling(null, open));
	const integrationCount: Observation<number> = integrations.kind === "known" ? { kind: "known", value: Object.values(integrations.value.integrations).filter(item => connectionsOf(item).some(signedIn)).length } : integrations;

	const refresh = useCallback(async (): Promise<void> => {
		await Promise.all([readinessStore.refresh(), ...(open ? [readinessGithubStore.refresh(), starterKitStore.refresh(), integrationsStore.refresh(null, { fresh: true })] : [])]);
	}, [open]);
	useEffect(() => {
		if (!open && !pending) return;
		const focus = (): void => {
			if (!document.hidden) void refresh();
		};
		window.addEventListener("focus", focus);
		return () => window.removeEventListener("focus", focus);
	}, [open, pending, refresh]);
	const check = useAction(refresh, "Could not check setup");

	useEffect(() => {
		if (open) requestAnimationFrame(() => document.getElementById(titleId)?.focus({ preventScroll: true }));
	}, [place, titleId, open]);

	const done: Record<StepId, boolean> = {
		provider: known(providers, count => count > 0),
		terminal: known(terminal, value => value !== "off"),
		kit: known(kit, value => value.pending === 0),
		tools: known(github, value => value.state === "signed-in") || known(integrationCount, count => count > 0),
		session: sessions === true,
	};
	const requiredFinished = STEPS.filter(item => item.need === "required" && done[item.id]).length;
	const close = (): void => {
		setMinimized(true);
		if (route) onClose();
	};
	const dismiss = (): void => {
		setDismissed(true);
		if (route) onClose();
	};

	return (
		<>
			<DialogPrimitive.Root open={open} onOpenChange={next => !next && close()}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/80" />
					<DialogPrimitive.Content
						aria-describedby={undefined}
						onOpenAutoFocus={event => event.preventDefault()}
						className="fixed top-1/2 left-1/2 z-50 flex h-[min(42rem,calc(100vh-2rem))] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
					>
						<DialogPrimitive.Title className="sr-only">Set up omp agents</DialogPrimitive.Title>
						{place === "welcome" ? (
							<Welcome titleId={titleId} done={done} onStart={() => setPlace(STEPS.find(step => !done[step.id])?.id ?? "provider")} onDismiss={dismiss} />
						) : (
							<Wizard
								place={place}
								titleId={titleId}
								done={done}
								requiredFinished={requiredFinished}
								rosterError={rosterError}
								onPlace={setPlace}
								onDismiss={dismiss}
								onNewSession={() => openNewSession()}
								body={{
									provider: <ProviderStep />,
									terminal: <TerminalStep terminal={terminal} />,
									kit: <KitStep kit={kit} />,
									tools: <ToolsStep github={github} integrations={integrationCount} onRefresh={() => check.run()} refreshing={check.pending} />,
									session: <SessionStep sessions={firstSession} />,
								}}
							/>
						)}
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
			{pending && settled && !open && <Bubble finished={requiredFinished} onDismiss={dismiss} />}
		</>
	);
}

function Wizard({ place, titleId, done, requiredFinished, rosterError, body, onPlace, onDismiss, onNewSession }: {
	place: StepId;
	titleId: string;
	done: Record<StepId, boolean>;
	requiredFinished: number;
	rosterError: string | null;
	body: Record<StepId, React.ReactNode>;
	onPlace: (place: Place) => void;
	onDismiss: () => void;
	onNewSession: () => void;
}) {
	const index = STEPS.findIndex(step => step.id === place);
	const step = STEPS[index]!;
	const next = STEPS[index + 1];
	const forward = next ? (
		done[step.id] ? (
			<Button trailingIcon={ArrowRight} onClick={() => onPlace(next.id)} {...activityControl("get-started.next")}>
				Next: {next.label}
			</Button>
		) : (
			<Button variant="secondary" onClick={() => onPlace(next.id)} {...activityControl("get-started.skip")}>
				Skip for now
			</Button>
		)
	) : done[step.id] ? (
		<Button onClick={onDismiss} {...activityControl("get-started.dismiss")}>
			Finish setup
		</Button>
	) : (
		<Button leadingIcon={Plus} onClick={onNewSession}>
			New session
		</Button>
	);

	return (
		<div className="@container/get-started flex min-w-0 flex-1">
			<nav aria-label="Setup steps" className="hidden w-60 shrink-0 flex-col gap-6 border-e border-border bg-surface-1 p-4 @2xl/get-started:flex">
				<div className="flex items-center gap-2.5 px-2 pt-1">
					<AppMark className="size-5 shrink-0" />
					<div className="min-w-0">
						<p className="text-[13px] font-medium">Set up omp agents</p>
						<p className="text-xs text-muted-foreground tabular-nums">
							{requiredFinished} of {REQUIRED_COUNT} required done
						</p>
					</div>
				</div>
				<ol className="space-y-0.5">
					{STEPS.map((item, position) => (
						<li key={item.id}>
							<button
								type="button"
								aria-current={item.id === place ? "step" : undefined}
								onClick={() => onPlace(item.id)}
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
				<Button variant="ghost" size="compact" className="mt-auto self-start" onClick={onDismiss} {...activityControl("get-started.dismiss")}>
					Skip setup
				</Button>
			</nav>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex items-center justify-between gap-3 ps-8 pe-3 pt-3">
					<p className="text-xs text-muted-foreground tabular-nums">
						Step {index + 1} of {STEPS.length}
					</p>
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="compact" className="@2xl/get-started:hidden" onClick={onDismiss} {...activityControl("get-started.dismiss")}>
							Skip setup
						</Button>
						<CloseButton />
					</div>
				</div>
				<div key={step.id} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-8 pt-2 pb-6 motion-safe:animate-in motion-safe:duration-200 motion-safe:ease-out motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
					<StepHeader id={titleId} title={step.title}>
						{step.summary}
					</StepHeader>
					{rosterError && (
						<Callout tone="warning" icon={CircleAlert}>
							Registry error: {rosterError}
						</Callout>
					)}
					{body[step.id]}
				</div>
				<footer className="flex items-center gap-2 border-t border-border px-8 py-4">
					<Button variant="ghost" leadingIcon={ArrowLeft} onClick={() => onPlace(index === 0 ? "welcome" : STEPS[index - 1]!.id)} {...activityControl("get-started.back")}>
						Back
					</Button>
					<div className="ms-auto flex items-center gap-2">{forward}</div>
				</footer>
			</div>
		</div>
	);
}
