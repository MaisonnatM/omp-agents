import { ChevronRight, ListChecks } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { View } from "../../src/shared/sessions";
import type { Item, TodoPhase, TodoTask } from "../../src/shared/transcript";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { activityControl } from "../activity";
import { useStoredState } from "../stored-state";
import { latestTodos } from "../transcript-view";
import { type ChangesSession, ChangesSections, useChanges } from "./todos-card-changes";

/** Whether the card shows the whole todo list, kept for every transcript; it starts folded to its summary. */
const OPEN_KEY = "omp-agents.todos-card-open";
const SHOWN_KEY = "omp-agents.todos-card-shown";

/** Whether transcripts show the card's todo list, which Settings → Preferences toggles. */
export const useTodosCardShown = () => useStoredState(SHOWN_KEY, raw => raw !== "false");

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

const isClosed = (task: TodoTask): boolean => task.status === "completed" || task.status === "abandoned";

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

function TaskText({ text }: { text: string }) {
	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={INLINE_ELEMENTS} unwrapDisallowed components={INLINE}>
			{text}
		</ReactMarkdown>
	);
}

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

function TodosSection({ phases }: { phases: TodoPhase[] }) {
	const [open, setOpen] = useStoredState(OPEN_KEY, raw => raw === "true");
	const all = phases.flatMap(phase => phase.tasks);
	const done = all.filter(isClosed).length;
	const current = all.find(task => task.status === "in_progress");
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger {...activityControl("transcript.todos")} className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 pt-2.5 pb-3 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				<ListChecks aria-hidden className="size-4 text-muted-foreground" />
				<span className="truncate text-sm">
					<span className="font-medium text-foreground">Todos</span>
					<span className="text-muted-foreground"> · {all.length} tasks</span>
				</span>
				<span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
					{done} of {all.length}
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
					aria-valuemax={all.length}
					aria-valuenow={done}
					aria-valuetext={`${done} of ${all.length} tasks done`}
					className="col-start-2 col-end-4 mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
				>
					<span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${all.length === 0 ? 0 : (done / all.length) * 100}%` }} />
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

interface SessionTodosCardProps {
	items: readonly Item[];
	view: View;
	working: boolean;
	/** The session whose files, images, and sources the card lists; omitted, it lists none. */
	changes?: ChangesSession;
}

/**
 * The agent's own todo list, as its latest `todo` call left it, and the files, images, and pages the view's agents
 * changed, took, and opened, each a section shown once it has something to list. The todo list is a summary of progress
 * and the task in progress, which unfolds into every phase, open tasks first. The card floats at the top right of its
 * transcript when the transcript is wide enough to keep it beside the messages, and otherwise sits above them.
 */
export function SessionTodosCard({ items, view, working, changes }: SessionTodosCardProps) {
	const phases = useMemo(() => latestTodos(items), [items]);
	const [todosShown] = useTodosCardShown();
	const todos = todosShown && phases.length > 0;
	const found = useChanges(view, changes);
	if (!todos && !found) return null;
	return (
		<section
			aria-label="Todos"
			data-todos-card
			className="mx-auto mt-3 max-h-[45%] min-h-0 w-[calc(100%-1.5rem)] max-w-[calc(var(--container-conversation)-1.5rem)] shrink-0 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-popover/95 text-popover-foreground shadow-sm backdrop-blur [scrollbar-width:thin] @min-[62.75rem]/conversation:absolute @min-[62.75rem]/conversation:top-3 @min-[62.75rem]/conversation:right-3 @min-[62.75rem]/conversation:z-10 @min-[62.75rem]/conversation:m-0 @min-[62.75rem]/conversation:max-h-[calc(100%-5rem)] @min-[62.75rem]/conversation:w-80 @min-[62.75rem]/conversation:max-w-none"
		>
			{todos && <TodosSection phases={phases} />}
			{found && changes && <ChangesSections view={view} session={changes} changes={found} working={working} />}
		</section>
	);
}
