/** One routine of a Bot: its task and runs, newest first, beside its settings, with Run now and its menu. */
import { ArrowLeft, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Routine, RoutineChange, RoutineRun, RoutineTask, TriggerEvent } from "../../../src/routines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { readTime } from "../../labels";
import { hashForBots } from "../../routing";
import { nextRunWords, runWords, scheduleWords, startsWords, taskWords, TRIGGER_WORDS } from "../../routines-model";
import { useAction } from "../../use-action";
import { useMinute } from "../../use-minute";
import { useDashboardActions } from "../dashboard-context";
import { PageFrame } from "../list-page";
import { MoreActionsMenu } from "../more-actions-menu";
import { RunDot, TaskIcon } from "./routine-marks";

interface RoutineActionsProps {
	routine: Routine;
	disabled: boolean;
	onChange: (change: RoutineChange) => void;
	onEdit: () => void;
	/** After **Delete** is confirmed and sent. */
	onDeleted: () => void;
}

/** A routine's menu, **Pause** or **Resume**, **Edit**, and **Delete**, which asks first in its place. */
function RoutineActions({ routine, disabled, onChange, onEdit, onDeleted }: RoutineActionsProps) {
	const [confirming, setConfirming] = useState(false);
	const { id, name, enabled } = routine;
	if (confirming) {
		return (
			<div role="group" aria-label={`Delete ${name}?`} className="flex shrink-0 items-center gap-2 text-xs">
				<span>Delete it and its runs?</span>
				<Button
					size="compact"
					disabled={disabled}
					onClick={() => {
						onChange({ op: "remove", id });
						onDeleted();
					}}
				>
					Delete routine
				</Button>
				<Button variant="ghost" size="compact" autoFocus onClick={() => setConfirming(false)}>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<MoreActionsMenu name={name} disabled={disabled}>
			<MenuItem onClick={() => onChange({ op: "enable", id, enabled: !enabled })}>
				{enabled ? <Pause /> : <Play />}
				{enabled ? "Pause" : "Resume"}
			</MenuItem>
			<MenuItem onClick={onEdit}>
				<Pencil />
				Edit
			</MenuItem>
			<MenuItem variant="destructive" onClick={() => setConfirming(true)}>
				<Trash2 />
				Delete
			</MenuItem>
		</MoreActionsMenu>
	);
}

/** Output longer than this many lines folds behind a disclosure. */
const FOLDED_OUTPUT_LINES = 20;

/** What a command printed, scrolling past a few lines, and folded when it is long. */
function CommandOutput({ output }: { output: string }) {
	const pre = (
		<pre
			aria-label="Output"
			// Focusable, so the keyboard can scroll it.
			tabIndex={0}
			className="max-h-64 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{output}
		</pre>
	);
	const lines = output.trimEnd().split("\n").length;
	if (lines <= FOLDED_OUTPUT_LINES) return pre;
	return (
		<details className="space-y-1.5">
			<summary className="cursor-pointer text-xs text-muted-foreground select-none">Show output ({lines} lines)</summary>
			{pre}
		</details>
	);
}

/** One run: when, how it went, what started it when a trigger did, and what its command printed or why it failed. */
function RunItem({ run }: { run: RoutineRun }) {
	const { outcome } = run;
	const output = outcome.kind === "command" && "output" in outcome.run ? outcome.run.output : "";
	return (
		<li className="space-y-2 px-3 py-2.5">
			<div className="flex min-h-7 items-center gap-2.5 text-sm">
				<RunDot run={run} />
				<span className="font-medium tabular-nums">{readTime(run.at)}</span>
				<span className="min-w-0 truncate text-xs text-muted-foreground">{runWords(run)}</span>
			</div>
			{(output.trim() !== "" || run.errors.length > 0 || run.triggeredBy.length > 0) && (
				<div className="space-y-2 pl-[1.375rem]">
					{run.triggeredBy.length > 0 && <TriggeredBy events={run.triggeredBy} />}
					{output.trim() !== "" && <CommandOutput output={output} />}
					{run.errors.length > 0 && (
						<ul aria-label="Errors" className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
							{run.errors.map((error, index) => (
								<li key={index} className="break-words">
									{error}
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</li>
	);
}

/** What a trigger saw that started a run, each a link when it has one. */
function TriggeredBy({ events }: { events: TriggerEvent[] }) {
	return (
		<ul aria-label="Started by" className="space-y-1 text-xs">
			{events.map((event, index) => (
				<li key={index} className="min-w-0">
					{event.url ? (
						<a href={event.url} target="_blank" rel="noreferrer" className="font-medium break-words underline-offset-2 hover:underline">
							{event.title}
						</a>
					) : (
						<span className="font-medium break-words">{event.title}</span>
					)}
					<p className="line-clamp-2 break-words text-muted-foreground">{event.detail}</p>
				</li>
			))}
		</ul>
	);
}

interface DetailProps {
	routine: Routine;
	/** The name of the Bot the routine belongs to. */
	botName: string;
	connected: boolean;
	onEdit: () => void;
}

const TASK_HEADING: Record<RoutineTask["kind"], string> = { prompt: "Message", command: "Command" };

/** What a routine's task card shows: the message or the command, whole. */
function TaskValue({ task }: { task: RoutineTask }) {
	switch (task.kind) {
		case "prompt":
			return <p className="whitespace-pre-wrap break-words">{task.prompt}</p>;
		case "command":
			return <code className="block font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{task.command}</code>;
		default: {
			const unhandled: never = task;
			return unhandled;
		}
	}
}

/** The schedules, then the triggers, one line each. */
function StartsValue({ routine }: { routine: Routine }) {
	return (
		<ul>
			{routine.schedules.map((schedule, index) => (
				<li key={index}>{scheduleWords(schedule)}</li>
			))}
			{routine.triggers.map(({ kind }) => (
				<li key={kind}>{TRIGGER_WORDS[kind]}</li>
			))}
		</ul>
	);
}

/** One routine: its task and runs, newest first, beside its settings. */
export function RoutineDetail({ routine, botName, connected, onEdit }: DetailProps) {
	const { task } = routine;
	const { request, send } = useDashboardActions();
	const now = useMinute();
	const onChange = (change: RoutineChange): void => send({ t: "routine", change });
	const run = useAction(() => request({ t: "routine", change: { op: "run-now", id: routine.id } }), "Could not run the routine");
	const settings: [string, ReactNode][] = [
		[
			"Status",
			<Badge variant="dot" size="compact" color={routine.enabled ? "green" : "gray"}>
				{routine.enabled ? "Active" : "Paused"}
			</Badge>,
		],
		[routine.triggers.length > 0 ? "Starts" : "Schedule", <StartsValue routine={routine} />],
		["Next run", <span className={cn("tabular-nums", !routine.enabled && "text-muted-foreground")}>{nextRunWords(routine, now)}</span>],
	];
	return (
		<PageFrame
			title={routine.name}
			meta={`${startsWords(routine)} · ${taskWords(task)}`}
			actions={
				<>
					<Button asChild variant="ghost" size="compact" leadingIcon={ArrowLeft}>
						<a href={hashForBots(routine.botId)}>Back to {botName}</a>
					</Button>
					<Button size="compact" leadingIcon={Play} disabled={!connected} loading={run.pending} onClick={() => run.run()}>
						Run now
					</Button>
					<RoutineActions
						routine={routine}
						disabled={!connected}
						onChange={onChange}
						onEdit={onEdit}
						onDeleted={() => {
							location.hash = hashForBots(routine.botId);
						}}
					/>
				</>
			}
		>
			<div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
				<div className="min-w-0 space-y-8">
					<section aria-labelledby="routine-task" className="space-y-2">
						<h3 id="routine-task" className="flex items-center gap-2 text-sm font-medium">
							<TaskIcon task={task} className="size-4 text-muted-foreground" />
							{TASK_HEADING[task.kind]}
						</h3>
						<div className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed">
							<TaskValue task={task} />
						</div>
					</section>
					<section aria-labelledby="routine-runs" className="space-y-2">
						<h3 id="routine-runs" className="flex items-baseline gap-2 text-sm font-medium">
							Runs
							<span className="tabular-nums text-muted-foreground">{routine.runs.length}</span>
							<span className="ml-auto text-xs font-normal text-muted-foreground">The last 10 runs stay here.</span>
						</h3>
						{routine.runs.length === 0 ? (
							<p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No runs yet. Run now starts one.</p>
						) : (
							<ul className="divide-y divide-border rounded-lg border border-border">
								{routine.runs.map(run => (
									<RunItem key={run.at} run={run} />
								))}
							</ul>
						)}
					</section>
				</div>
				<aside aria-label={`Settings of ${routine.name}`} className="lg:sticky lg:top-6 lg:self-start">
					<dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm lg:grid-cols-1 lg:gap-y-4">
						{settings.map(([term, value]) => (
							<div key={term} className="contents lg:block lg:space-y-1">
								<dt className="text-muted-foreground lg:text-xs">{term}</dt>
								<dd className="min-w-0">{value}</dd>
							</div>
						))}
					</dl>
				</aside>
			</div>
		</PageFrame>
	);
}
