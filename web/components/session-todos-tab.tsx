import { ChevronRight, Circle, CircleAlert, CircleCheck, CircleSlash, LoaderCircle, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TodoPhase, TodoTask } from "../../src/shared/transcript";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const STATUS: Record<TodoTask["status"], { icon: LucideIcon; label: string; className: string }> = {
	pending: { icon: Circle, label: "To do", className: "text-muted-foreground/60" },
	in_progress: { icon: LoaderCircle, label: "In progress", className: "text-blue-500 motion-safe:animate-spin" },
	completed: { icon: CircleCheck, label: "Done", className: "text-emerald-500" },
	blocked: { icon: CircleAlert, label: "Blocked", className: "text-amber-500" },
	abandoned: { icon: CircleSlash, label: "Dropped", className: "text-muted-foreground/60" },
};

const isClosed = (task: TodoTask): boolean => task.status === "completed" || task.status === "abandoned";

/** How many tasks of `phases` are still open, which the tab's badge counts. */
export const openTodos = (phases: readonly TodoPhase[]): number => phases.reduce((open, phase) => open + phase.tasks.filter(task => !isClosed(task)).length, 0);

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
	const { icon: Icon, label, className } = STATUS[task.status];
	const current = task.status === "in_progress" || task.status === "blocked";
	return (
		<li className={cn("flex items-start gap-2 rounded-md px-2 py-1 text-sm", current && "bg-muted/60 py-1.5")}>
			<Icon aria-label={label} role="img" className={cn("mt-0.5 size-4 shrink-0", className)} />
			<span className="min-w-0 flex-1">
				<span className={cn("break-words", isClosed(task) ? "text-muted-foreground" : "text-foreground", current && "font-medium")}>
					<TaskText text={task.content} />
				</span>
				{task.blocker && <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">{task.blocker}</span>}
			</span>
		</li>
	);
}

/** A fold with a chevron; `summary` stays visible while it is shut. */
function Fold({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className={cn("flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60", className)}>
				<ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				{summary}
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
		<ul className="flex flex-col">
			{list.map((task, at) => (
				<TaskRow key={`${at}:${task.content}`} task={task} />
			))}
		</ul>
	);
	if (open.length === 0) {
		return (
			<section aria-label={label}>
				<Fold
					summary={
						<>
							<CircleCheck aria-hidden className="size-3.5 shrink-0 text-emerald-500" />
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
		<section aria-label={label} className="flex flex-col gap-0.5">
			<h3 className="flex items-baseline gap-2 px-2 text-xs font-medium text-muted-foreground">
				<span className="truncate">{phase.name}</span>
				<PhaseCount done={closed.length} total={phase.tasks.length} />
			</h3>
			{tasks(open)}
			{closed.length > 0 && <Fold summary={`${closed.length} completed`}>{tasks(closed)}</Fold>}
		</section>
	);
}

/** The agent's own todo list in the right sidebar, as its latest `todo` call left it: progress on top, open tasks first, finished work folded. */
export function SessionTodosTab({ phases }: { phases: readonly TodoPhase[] }) {
	const all = phases.flatMap(phase => phase.tasks);
	const done = all.filter(isClosed).length;
	const current = all.find(task => task.status === "in_progress");
	return (
		<div className="flex flex-col gap-3 px-2 pb-4">
			<div className="flex flex-col gap-1.5 px-2">
				<div className="flex items-baseline justify-between text-xs text-muted-foreground">
					<span className="font-medium text-foreground">Plan</span>
					<span className="tabular-nums">
						{done} of {all.length}
					</span>
				</div>
				<div role="progressbar" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={done} className="h-px w-full bg-border">
					<div className="h-px bg-foreground transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${all.length === 0 ? 0 : (done / all.length) * 100}%` }} />
				</div>
				{current && (
					<p className="truncate text-xs text-muted-foreground">
						Working on: <TaskText text={current.content} />
					</p>
				)}
			</div>
			{phases.map((phase, index) => (
				<Phase key={`${index}:${phase.name}`} phase={phase} label={phase.name || `Phase ${index + 1}`} />
			))}
		</div>
	);
}
