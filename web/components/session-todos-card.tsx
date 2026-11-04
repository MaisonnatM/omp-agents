import { ChevronDown, ChevronRight, ListChecks, Ship } from "lucide-react";
import { memo, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SHIP_STAGES, type ShipProgress, type View } from "../../src/shared/sessions";
import type { TodoPhase, TodoTask } from "../../src/shared/transcript";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { activityControl } from "../activity";
import { keyedStore } from "../keyed-store";
import { hashForView } from "../routing";
import { useStoredState } from "../stored-state";
import { subagentTree } from "../todos-card-subagents-model";
import { countLabel, isClosed, STAGE_LABEL, type StripSummary, shipDone, shipStep, stripSummary, todoTally, WORK_LABEL } from "../todos-strip-model";
import type { SubagentLinksValue } from "./subagent-links";
import { type ChangesSession, ChangesSections, useChanges } from "./todos-card-changes";
import { SubagentsSection } from "./todos-card-subagents";
import { Stepper } from "./arc/stepper";

/** Whether the card shows the whole todo list, kept for every transcript; it starts unfolded. */
const OPEN_KEY = "omp-agents.todos-card-open";
const SHOWN_KEY = "omp-agents.todos-card-shown";
const SHIP_OPEN_KEY = "omp-agents.todos-card-ship-open";

/** Whether transcripts show the whole Todos card, which the checklist toggle in the session header and Settings → Preferences both toggle. */
export const useTodosCardShown = () => useStoredState(SHOWN_KEY, raw => raw !== "false");

/** Per view hash, how many mounted Todos cards have a section to show, so the header toggle shows only while one could appear. */
const filledCards = keyedStore(0);

/** The session header's checklist toggle, pressed while the Todos card shows in every pane, and absent while the view's card has nothing to show. */
export function TodosCardToggle({ view }: { view: View }) {
	const [shown, setShown] = useTodosCardShown();
	const filled = filledCards.use(hashForView(view)) > 0;
	if (!filled) return null;
	return (
		<Tooltip content={shown ? "Hide the todos card" : "Show the todos card: todos, ship steps, subagents, files, images, and sources"} side="bottom">
			<Button
				{...activityControl("todos-card.toggle")}
				variant="ghost"
				size="icon-compact"
				aria-label="Todos card"
				aria-pressed={shown}
				active={shown}
				onClick={() => setShown(value => !value)}
			>
				<ListChecks />
			</Button>
		</Tooltip>
	);
}

const STATUS_LABEL: Record<TodoTask["status"], string> = {
	pending: "To do",
	in_progress: "In progress",
	completed: "Done",
	blocked: "Blocked",
	abandoned: "Dropped",
};

/** Each status has its own shape, so none rests on color: a ring, a spinning arc, a checked disc, a disc with a bang, a dashed ring. */
function StatusGlyph({ status }: { status: TodoTask["status"] }) {
	const shape = (() => {
		switch (status) {
			case "pending":
				return <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/50" />;
			case "in_progress":
				return (
					<g className="origin-center text-foreground [transform-box:fill-box] motion-safe:animate-spin">
						<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
						<path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</g>
				);
			case "completed":
				return (
					<>
						<circle cx="8" cy="8" r="7" className="fill-emerald-500" />
						<path d="M5 8.25 7.1 10.3 11 6" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-popover" />
					</>
				);
			case "blocked":
				return (
					<>
						<circle cx="8" cy="8" r="7" className="fill-amber-500" />
						<path d="M8 4.5v4" fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-popover" />
						<circle cx="8" cy="11.25" r="0.9" className="fill-popover" />
					</>
				);
			case "abandoned":
				return <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.2" className="text-muted-foreground/50" />;
		}
	})();
	return (
		<svg viewBox="0 0 16 16" role="img" aria-label={STATUS_LABEL[status]} className="size-4 shrink-0">
			{shape}
		</svg>
	);
}

// A task is one line of inline Markdown: code, bold, italics, strikes, and links, without blocks.
const INLINE: Components = {
	p: ({ children }) => <>{children}</>,
	code: ({ children }) => <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">{children}</code>,
	a: ({ children, href }) => (
		<a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
			{children}
		</a>
	),
};
const INLINE_ELEMENTS = ["p", "code", "strong", "em", "del", "a"];
/** Inside a button, where a link cannot nest, a link shows as its text. */
const INLINE_TEXT_ELEMENTS = INLINE_ELEMENTS.filter(element => element !== "a");

/** A task's text as inline markdown; memoized on the text, so a render of the card leaves the parse alone. */
const TaskText = memo(function TaskText({ text, links = true }: { text: string; links?: boolean }) {
	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={links ? INLINE_ELEMENTS : INLINE_TEXT_ELEMENTS} unwrapDisallowed components={INLINE}>
			{text}
		</ReactMarkdown>
	);
});

function TaskRow({ task }: { task: TodoTask }) {
	const active = task.status === "in_progress";
	return (
		<li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 px-3 py-1.5 text-sm leading-5">
			<span className="flex h-5 items-center">
				<StatusGlyph status={task.status} />
			</span>
			<span className="min-w-0">
				<span
					className={cn(
						"break-words",
						isClosed(task) ? "text-muted-foreground" : "text-foreground",
						task.status === "abandoned" && "line-through decoration-muted-foreground/50",
						active && "shimmer motion-reduce:shimmer-none [&_code]:[-webkit-text-fill-color:currentColor]",
					)}
				>
					<TaskText text={task.content} />
				</span>
				{task.blocker && (
					<span className="mt-0.5 block text-xs text-muted-foreground">
						<span className="font-medium text-amber-600 dark:text-amber-400">Blocked</span> {task.blocker}
					</span>
				)}
			</span>
		</li>
	);
}

/** A fold with a chevron in the glyph column; `summary` stays visible while it is shut. */
function Fold({ summary, children }: { summary: ReactNode; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-3 px-3 py-1.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				<ChevronRight aria-hidden className={cn("mx-auto size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				<span className="flex min-w-0 items-center gap-2">{summary}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>{children}</CollapsibleContent>
		</Collapsible>
	);
}

function PhaseCount({ done, total }: { done: number; total: number }) {
	return (
		<span className="ml-auto shrink-0 tabular-nums">
			{done}/{total}
		</span>
	);
}

function Phase({ phase, label }: { phase: TodoPhase; label: string }) {
	const closed = phase.tasks.filter(isClosed);
	const open = phase.tasks.filter(task => !isClosed(task));
	const tasks = (list: readonly TodoTask[]) => (
		<ol className="flex flex-col">
			{list.map((task, at) => (
				<TaskRow key={`${at}:${task.content}`} task={task} />
			))}
		</ol>
	);
	if (open.length === 0) {
		return (
			<section aria-label={label}>
				<Fold
					summary={
						<>
							<span className="truncate font-medium">{phase.name}</span>
							<PhaseCount done={closed.length} total={phase.tasks.length} />
						</>
					}
				>
					{tasks(closed)}
				</Fold>
			</section>
		);
	}
	return (
		<section aria-label={label} className="flex flex-col">
			<h3 className="flex items-baseline gap-2 py-1 pr-3 pl-10 text-xs font-medium text-muted-foreground">
				<span className="truncate">{phase.name}</span>
				<PhaseCount done={closed.length} total={phase.tasks.length} />
			</h3>
			{tasks(open)}
			{closed.length > 0 && <Fold summary={`${closed.length} done`}>{tasks(closed)}</Fold>}
		</section>
	);
}

function TodosSection({ phases }: { phases: readonly TodoPhase[] }) {
	const [open, setOpen] = useStoredState(OPEN_KEY, raw => raw !== "false");
	const { count, done, total: all, current } = todoTally(phases);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger {...activityControl("transcript.todos")} className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 pt-2.5 pb-3 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				<ListChecks aria-hidden className="size-4 text-muted-foreground" />
				<span className="truncate text-sm">
					<span className="font-medium text-foreground">Todos</span>
					<span className="text-muted-foreground"> · {countLabel(all, "task", "tasks")}</span>
				</span>
				<span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
					{count}
					<ChevronRight aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				</span>
				{current && (
					<span className="col-start-2 col-end-4 truncate text-sm text-foreground/80">
						<TaskText text={current.content} />
					</span>
				)}
				<span
					role="progressbar"
					aria-label="Tasks done"
					aria-valuemin={0}
					aria-valuemax={all}
					aria-valuenow={done}
					aria-valuetext={`${done} of ${all} tasks done`}
					className="col-start-2 col-end-4 mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
				>
					<span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${all === 0 ? 0 : (done / all) * 100}%` }} />
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t border-border">
				<div className="flex flex-col gap-2 py-1.5">
					{phases.map((phase, index) => (
						<Phase key={`${index}:${phase.name}`} phase={phase} label={phase.name || `Phase ${index + 1}`} />
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** The /ship run's stages in order: the ones before the current stage done, the current one in progress, and every one done once merged. */
function ShipSection({ ship }: { ship: ShipProgress }) {
	const [open, setOpen] = useStoredState(SHIP_OPEN_KEY, raw => raw !== "false");
	const done = shipDone(ship);
	const refs = [ship.issue, ship.pr === undefined ? undefined : `#${ship.pr}`].filter(Boolean).join(" · ");
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger {...activityControl("transcript.ship")} className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 pt-2.5 pb-3 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				<Ship aria-hidden className="size-4 text-muted-foreground" />
				<span className="truncate text-sm">
					<span className="font-medium text-foreground">Ship</span>
					{refs && <span className="text-muted-foreground"> · {refs}</span>}
				</span>
				<span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
					{shipStep(ship) ?? "Done"}
					<ChevronRight aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				</span>
				<span className="col-start-2 col-end-4 truncate text-sm text-foreground/80">
					{STAGE_LABEL[ship.stage]}
					{ship.work && <span className="text-muted-foreground"> · {WORK_LABEL[ship.work]}</span>}
				</span>
				<span
					role="progressbar"
					aria-label="Ship stages done"
					aria-valuemin={0}
					aria-valuemax={SHIP_STAGES.length}
					aria-valuenow={done}
					aria-valuetext={`${done} of ${SHIP_STAGES.length} stages done`}
					className="col-start-2 col-end-4 mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
				>
					<span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${(done / SHIP_STAGES.length) * 100}%` }} />
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t border-border">
				<Stepper
					className="px-3 py-3"
					label="Ship stages"
					completeLabel="Merged"
					current={done}
					steps={SHIP_STAGES.map(stage => ({ id: stage, label: STAGE_LABEL[stage], ...(stage === ship.stage && ship.work ? { description: WORK_LABEL[ship.work] } : {}) }))}
				/>
			</CollapsibleContent>
		</Collapsible>
	);
}

interface SessionTodosCardProps {
	/** The agent's todo list as its latest successful `todo` call left it. */
	phases: readonly TodoPhase[];
	view: View;
	working: boolean;
	/** The session whose files, images, and sources the card lists; omitted, it lists none. */
	changes?: ChangesSession;
	/** The live session's subagents, listed in their own section; `null` in a past session or where activity is hidden. */
	subagents: SubagentLinksValue | null;
	/** The session's /ship run, shown as its own section; `null` without one. */
	ship: ShipProgress | null;
}

/**
 * The strip's one line: an icon, the lead, then the counts that fit, and the chevron at the end.
 * A count shows whole or not at all: they drop from the last one while the lead would get less than its own width or
 * 12rem, whichever is less, so a short lead such as a /ship step stays whole and a long task still leaves room for counts;
 * the dropped ones stay laid out, unseen, so their widths are known as the line widens again.
 */
function StripLine({ summary: { lead, counts }, open }: { summary: StripSummary; open: boolean }) {
	const [fit, setFit] = useState(counts.length);
	const row = useRef<HTMLSpanElement>(null);
	const leadText = useRef<HTMLSpanElement>(null);
	const content = `${JSON.stringify(lead)}\n${counts.join("\n")}`;
	useLayoutEffect(() => {
		const line = row.current;
		const text = leadText.current;
		if (!line || !text) return;
		const measure = (): void => {
			const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
			let room = line.clientWidth - Math.min(text.scrollWidth, 12 * rem);
			let fits = 0;
			for (const count of line.querySelectorAll<HTMLElement>("[data-count]")) {
				room -= count.offsetWidth;
				if (room < 0) break;
				fits++;
			}
			setFit(fits);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(line);
		return () => observer.disconnect();
	}, [content]);
	return (
		<>
			{lead.kind === "ship" ? (
				<Ship aria-hidden className="size-4 shrink-0 text-muted-foreground" />
			) : lead.kind === "task" ? (
				<StatusGlyph status="in_progress" />
			) : (
				<ListChecks aria-hidden className="size-4 shrink-0 text-muted-foreground" />
			)}
			<span ref={row} className="relative flex min-w-0 flex-1 items-center overflow-hidden">
				<span ref={leadText} className="min-w-0 truncate">
					{lead.kind === "ship" && (
						<>
							<span className="font-medium">{lead.stage}</span>
							{lead.work && <span className="text-muted-foreground"> · {lead.work}</span>}
							{lead.step && <span className="text-muted-foreground tabular-nums"> · {lead.step}</span>}
						</>
					)}
					{lead.kind === "task" && <TaskText text={lead.markdown} links={false} />}
					{lead.kind === "count" && <span className="font-medium tabular-nums">{lead.text}</span>}
				</span>
				{counts.map((count, index) => (
					<span
						key={count}
						data-count
						className={cn("shrink-0 whitespace-nowrap text-muted-foreground tabular-nums before:px-1.5 before:content-['·']", index >= fit && "invisible absolute top-0 left-0")}
					>
						{count}
					</span>
				))}
			</span>
			<ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
		</>
	);
}

/**
 * The agent's own todo list, as its latest `todo` call left it, the subagents under the view's agent, and the files,
 * images, and pages the view's agents changed, took, and opened, each a section shown once it has something to list.
 * It shows as one strip above the messages, with the /ship stage or the task in progress and each section's count in
 * its header's words; a click opens the sections over the messages, in the conversation's bounds, and a click outside
 * or Escape closes them, Escape giving the focus back to the strip.
 * The sections' dialogs render inside the overlay, and Radix counts a click in them as inside it, so it stays open
 * under a file's or an image's dialog.
 * Memoized: `phases` keeps its identity until a `todo` call changes it, so a streamed token leaves the card as it is.
 */
export const SessionTodosCard = memo(function SessionTodosCard({ phases, view, working, changes, subagents, ship }: SessionTodosCardProps) {
	const [shown] = useTodosCardShown();
	const found = useChanges(view, changes);
	const todos = phases.length > 0;
	const nodes = subagents ? subagentTree(subagents.agents, view.kind === "live" ? view.agentId : null) : [];
	const summary = stripSummary({ ship, phases, subagents: nodes.length, files: found?.files.length ?? 0, images: found?.media.length ?? 0, sources: found?.sources.length ?? 0 });
	const filled = summary !== null;
	const key = hashForView(view);
	// Open for one view only, so opening a subagent from the overlay leaves the next view's strip shut.
	const [openFor, setOpenFor] = useState<string | null>(null);
	const open = openFor === key;
	// The overlay sizes itself to the conversation, the strip's `[data-conversation]` wrapper, not to the window, so it never covers the composer.
	const [bounds, setBounds] = useState<Element | null>(null);
	const strip = useCallback((node: HTMLButtonElement | null) => setBounds(node?.closest("[data-conversation]") ?? null), []);
	useLayoutEffect(() => {
		if (!filled) return;
		filledCards.set(key, filledCards.get(key) + 1);
		return () => filledCards.set(key, filledCards.get(key) - 1);
	}, [key, filled]);
	if (!shown || !summary) return null;
	return (
		<Popover open={open} onOpenChange={next => setOpenFor(next ? key : null)}>
			<PopoverTrigger asChild>
				<button
					{...activityControl("todos-card.open")}
					ref={strip}
					type="button"
					className="mx-auto mt-3 flex h-9 w-[calc(100%-1.5rem)] max-w-[calc(var(--container-conversation)-1.5rem)] shrink-0 items-center gap-3 rounded-2xl border border-border bg-popover/95 px-3 text-left text-sm text-popover-foreground shadow-sm backdrop-blur outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted/60"
				>
					<StripLine summary={summary} open={open} />
				</button>
			</PopoverTrigger>
			<PopoverContent
				aria-label="Todos"
				side="bottom"
				sideOffset={6}
				avoidCollisions={false}
				collisionBoundary={bounds}
				collisionPadding={12}
				// Under the dialogs a file or an image opens, whose dim layer is z-40 and comes later in the page.
				className="z-40 flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) flex-col divide-y divide-border overflow-y-auto rounded-2xl p-0 shadow-lg [scrollbar-width:thin]"
				// The overlay itself takes the focus, so a click on the strip lights no ring on the first section; Tab goes on into the sections.
				onOpenAutoFocus={event => {
					event.preventDefault();
					(event.currentTarget as HTMLElement).focus();
				}}
				onEscapeKeyDown={event => {
					// Escape in a section's menu, which renders outside the overlay, closes only that menu.
					const target = event.target;
					if (target instanceof Element && target.closest("[role=menu]") && !target.closest("[data-slot=popover-content]")) event.preventDefault();
				}}
			>
				{ship && <ShipSection ship={ship} />}
				{todos && <TodosSection phases={phases} />}
				{subagents && nodes.length > 0 && <SubagentsSection links={subagents} nodes={nodes} />}
				{found && changes && <ChangesSections view={view} session={changes} changes={found} working={working} />}
			</PopoverContent>
		</Popover>
	);
});
