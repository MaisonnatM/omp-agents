/**
 * Running now: a pill that counts the tasks running, waiting on you, and finished, and opens a list of them, each a
 * row with a ring that fills as its steps finish, its title, the step it is on, and what it waits for.
 * After affectUI's Running Now (Clean).
 */
import { IconCheckmark1, IconChevronDownSmall } from "central-icons";
import { type MouseEvent, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type RunningTaskState = "running" | "needs-you" | "done";

export interface RunningTask {
	/** Passed back to `onOpen`. */
	id: string;
	title: string;
	/** What it does now; for a task that needs you, what it asks; for a finished one, what it said. */
	step: string;
	state: RunningTaskState;
	/** Steps finished so far, out of `total`, which fill the ring; a `total` of 0 shows no count. */
	done: number;
	total: number;
}

/** Each state's mark in the pill, its color, and its words after a count. */
const STATES: Record<RunningTaskState, { mark: string; color: string; words: (count: number) => string }> = {
	running: { mark: "size-2 rounded-full ring-[1.5px] ring-inset ring-success", color: "text-success", words: () => "running" },
	"needs-you": { mark: "mx-px size-1.5 rounded-full bg-warning", color: "text-warning", words: count => (count === 1 ? "needs you" : "need you") },
	done: { mark: "mx-px size-1.5 rounded-full bg-primary", color: "text-primary", words: () => "finished" },
};

const ORDER: RunningTaskState[] = ["running", "needs-you", "done"];

const PIE = 2 * Math.PI * 2;

/** The pill and its list of `tasks`, in the order given; nothing while there is none. `onOpen` runs on a row's click. */
export function RunningNow({ tasks, title, onOpen }: { tasks: readonly RunningTask[]; title: string; onOpen: (id: string, event: MouseEvent) => void }) {
	const [open, setOpen] = useState(false);
	const parts = ORDER.flatMap(state => {
		const count = tasks.filter(task => task.state === state).length;
		return count > 0 ? [{ state, count }] : [];
	});
	if (parts.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${title}: ${parts.map(({ state, count }) => `${count} ${STATES[state].words(count)}`).join(", ")}`}
					className="group inline-flex h-7 max-w-full items-center gap-2 rounded-md bg-card pr-2 pl-2.5 text-xs whitespace-nowrap text-muted-foreground shadow-xs ring-1 ring-border outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				>
					{parts.map(({ state, count }, index) => (
						<span key={state} className="inline-flex items-center gap-1">
							{index > 0 && (
								<span aria-hidden className="mr-1 text-muted-foreground/50">
									·
								</span>
							)}
							<span aria-hidden className={cn("mr-0.5 shrink-0", STATES[state].mark)} />
							<span className="font-medium text-foreground tabular-nums">{count}</span>
							<span>{STATES[state].words(count)}</span>
						</span>
					))}
					<IconChevronDownSmall aria-hidden className="-ml-0.5 size-3 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
				</button>
			</PopoverTrigger>
			<PopoverContent aria-label={title} className="w-[min(340px,calc(100vw-32px))] rounded-[10px] p-1">
				<div aria-hidden className="flex h-7 items-center gap-1.5 px-2 text-[10px] leading-4 font-medium tracking-[0.5px]">
					<span className="text-muted-foreground uppercase">{title}</span>
					<span className="text-muted-foreground/60 tabular-nums">{tasks.length}</span>
				</div>
				<ul className="grid max-h-[min(286px,calc(100dvh-200px))] overflow-y-auto overscroll-contain">
					{tasks.map(task => (
						<Row
							key={task.id}
							task={task}
							onOpen={event => {
								setOpen(false);
								onOpen(task.id, event);
							}}
						/>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

/** One 52px row in every state, so a step or badge that changes never moves another row. */
function Row({ task, onOpen }: { task: RunningTask; onOpen: (event: MouseEvent) => void }) {
	const { title, state, step, done, total } = task;
	const fill = state === "done" ? 1 : total > 0 ? Math.min(1, done / total) : 0;
	const count = total > 0 ? `${done}/${total}` : null;
	const label = [`${title}, ${STATES[state].words(1)}`, step, count && `${done} of ${total} steps`].filter(Boolean).join(". ");
	return (
		<li className="flex h-13 items-center rounded-md transition-colors hover:bg-accent/60">
			<button type="button" aria-label={label} onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pr-1.5 pl-2.5 text-left text-[13px] outline-none focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
				<svg viewBox="0 0 14 14" aria-hidden className={cn("size-3.5 shrink-0 fill-none stroke-current", STATES[state].color)}>
					<circle cx="7" cy="7" r="6" strokeWidth="1.5" />
					<circle cx="7" cy="7" r="2" strokeWidth="4" transform="rotate(-90 7 7)" style={{ strokeDasharray: `${fill * PIE} ${PIE}` }} className="transition-[stroke-dasharray] duration-700" />
				</svg>
				<span className="grid min-w-0 flex-1">
					<span title={title} className={cn("truncate font-medium", state === "done" ? "text-foreground/75" : "text-foreground")}>
						{title}
					</span>
					<span title={step} className="truncate text-xs text-muted-foreground">
						{step}
					</span>
				</span>
				{state === "needs-you" ? (
					<span className="h-4.5 shrink-0 rounded-sm bg-warning-surface px-1.5 text-[11px] leading-4.5 font-medium whitespace-nowrap text-warning-foreground">Needs you</span>
				) : (
					count && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
				)}
			</button>
			<span className="flex min-w-10 shrink-0 justify-end pr-1.5">
				{state === "done" && (
					<span aria-hidden className="grid size-7 place-items-center text-primary">
						<IconCheckmark1 className="size-3.5" />
					</span>
				)}
				{state === "needs-you" && (
					<button type="button" aria-label={`Open ${title}`} onClick={onOpen} className="h-7 rounded-md bg-card px-2 text-xs font-medium text-foreground shadow-xs ring-1 ring-border outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
						Open
					</button>
				)}
			</span>
		</li>
	);
}
