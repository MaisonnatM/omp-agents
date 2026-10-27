import { ArrowLeft, Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Routine, RoutineChange, RoutineRun, RoutineTask } from "../../../src/routines";
import type { RosterHost, View } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { age, modeOf, readTime, SPLIT_CLICK } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { hashForRoutines } from "../../routing";
import { draftOf, newDraft, nextRunWords, type RoutineDraft, runWords, scheduleWords, schedulesWords, taskWords } from "../../routines-model";
import { useAction } from "../../use-action";
import { useMinute } from "../../use-minute";
import { useDashboardActions } from "../dashboard-context";
import { PageFrame } from "../list-page";
import { SessionChip } from "../session-chip";
import { statusLabel } from "../status-dot";
import { MoreActionsMenu } from "../more-actions-menu";
import { RoutineEditor } from "./routine-editor";
import { RunDot, TaskIcon } from "./routine-marks";

interface RoutineActionsProps {
	routine: Routine;
	disabled: boolean;
	onChange: (change: RoutineChange) => void;
	onRun?: () => void;
	running?: boolean;
	onEdit: () => void;
	/** After **Delete** is confirmed and sent. */
	onDeleted?: () => void;
}

/** A routine's menu, **Run now**, **Pause** or **Resume**, **Edit**, and **Delete**, which asks first in its place. */
function RoutineActions({ routine, disabled, onChange, onEdit, onDeleted, onRun, running = false }: RoutineActionsProps) {
	const [confirming, setConfirming] = useState(false);
	const { id, name, enabled } = routine;
	const { request } = useDashboardActions();
	const run = useAction(() => request({ t: "routine", change: { op: "run-now", id } }), "Could not run the routine");
	const pending = running || run.pending;
	if (confirming) {
		return (
			<div role="group" aria-label={`Delete ${name}?`} className="flex shrink-0 items-center gap-2 text-xs">
				<span>Delete it and its runs?</span>
				<Button
					size="compact"
					disabled={disabled}
					onClick={() => {
						onChange({ op: "remove", id });
						onDeleted?.();
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
		<>
			{pending && !onRun && <Button size="compact" aria-label="Starting routine" loading>Starting…</Button>}
			<MoreActionsMenu name={name} disabled={disabled || pending}>
				<MenuItem disabled={pending} aria-busy={pending || undefined} onClick={onRun ?? run.run}>
					<Play />
					{pending ? "Starting…" : "Run now"}
				</MenuItem>
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
		</>
	);
}

/** The view a run's session opens: live while it still runs, else its transcript. */
function sessionView(started: { instanceId: string; sessionId: string }, hosts: RosterHost[]): { view: View; host: RosterHost | null } {
	const host = hosts.find(h => h.instanceId === started.instanceId || h.sessionId === started.sessionId) ?? null;
	return { view: host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId: started.sessionId }, host };
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

function RunItem({ run, routine, hosts }: { run: RoutineRun; routine: Routine; hosts: RosterHost[] }) {
	const { open } = useDashboardActions();
	const { outcome } = run;
	const started = outcome.kind === "session" ? sessionView(outcome, hosts) : null;
	const output = outcome.kind === "command" && "output" in outcome.run ? outcome.run.output : "";
	return (
		<li className="space-y-2 px-3 py-2.5">
			<div className="flex min-h-7 items-center gap-2.5 text-sm">
				<RunDot run={run} />
				<span className="font-medium tabular-nums">{readTime(run.at)}</span>
				<span className="min-w-0 truncate text-xs text-muted-foreground">{runWords(run)}</span>
				{started && (
					<div role="group" aria-label="Session it started" className="ml-auto flex shrink-0 text-xs">
						<SessionChip
							label={routine.name}
							status={started.host?.status ?? null}
							title={`Open the session${started.host ? `, ${statusLabel(started.host.status)}` : ", which ended"} (${SPLIT_CLICK} to split)`}
							filled={false}
							onClick={event => open(started.view, modeOf(event))}
						/>
					</div>
				)}
			</div>
			{(output.trim() !== "" || run.errors.length > 0) && (
				<div className="space-y-2 pl-[1.375rem]">
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

interface DetailProps {
	routine: Routine;
	hosts: RosterHost[];
	now: number;
	connected: boolean;
	onChange: (change: RoutineChange) => void;
	onEdit: () => void;
}

/** What a routine's task card shows: the prompt or the command, whole. */
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

/** The schedules, one line each. */
function ScheduleValue({ schedules }: { schedules: Routine["schedules"] }) {
	return (
		<ul>
			{schedules.map((schedule, index) => (
				<li key={index}>{scheduleWords(schedule)}</li>
			))}
		</ul>
	);
}

/** One routine: its task and runs, newest first, beside its settings. */
function RoutineDetail({ routine, hosts, now, connected, onChange, onEdit }: DetailProps) {
	const { task } = routine;
	const { request } = useDashboardActions();
	const run = useAction(() => request({ t: "routine", change: { op: "run-now", id: routine.id } }), "Could not run the routine");
	const settings: [string, ReactNode][] = [
		[
			"Status",
			<Badge variant="dot" size="compact" color={routine.enabled ? "green" : "gray"}>
				{routine.enabled ? "Active" : "Paused"}
			</Badge>,
		],
		["Schedule", <ScheduleValue schedules={routine.schedules} />],
		["Next run", <span className={cn("tabular-nums", !routine.enabled && "text-muted-foreground")}>{nextRunWords(routine, now)}</span>],
		[
			"Workspace",
			<span className="block truncate font-mono text-xs" title={routine.cwd}>
				{routine.cwd}
			</span>,
		],
	];
	if (task.kind === "prompt") {
		settings.push(["Skill", routine.skill ?? "None"], ["Pin", task.pin ? "When it finishes, in place of the previous session" : "No"]);
	}
	return (
		<PageFrame
			title={routine.name}
			meta={`${schedulesWords(routine.schedules)} · ${taskWords(task)}`}
			actions={
				<>
					<Button asChild variant="ghost" size="compact" leadingIcon={ArrowLeft}>
						<a href={hashForRoutines(null)}>All routines</a>
					</Button>
					<Button size="compact" leadingIcon={Play} disabled={!connected} loading={run.pending} onClick={() => run.run()}>
						Run now
					</Button>
					<RoutineActions
						routine={routine}
						disabled={!connected}
						onChange={onChange}
						onRun={run.run}
						running={run.pending}
						onEdit={onEdit}
						onDeleted={() => {
							location.hash = hashForRoutines(null);
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
							{task.kind === "prompt" ? "Prompt" : "Command"}
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
									<RunItem key={run.at} run={run} routine={routine} hosts={hosts} />
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

interface RowProps {
	routine: Routine;
	now: number;
	connected: boolean;
	onChange: (change: RoutineChange) => void;
	onEdit: () => void;
}

/** The widths the rows' columns and their group heading's labels share. */
const COLUMN = { schedule: "w-48", last: "w-20", next: "w-32" } as const;

/** One line: the task's icon, the name and the task, the schedules, the last run's dot and age, and the next run; its menu shows on hover or focus. */
function RoutineRow({ routine, now, connected, onChange, onEdit }: RowProps) {
	const { name, enabled, task, runs } = routine;
	const last = runs[0];
	const schedule = schedulesWords(routine.schedules);
	const preview = taskWords(task);
	return (
		<li className="group/routine relative flex h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-accent/50 has-[a:focus-visible]:bg-accent/50">
			<span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
				{enabled ? <TaskIcon task={task} className="size-3.5" /> : <Pause aria-label="Paused" className="size-3.5" />}
			</span>
			<div className="flex min-w-0 flex-1 items-baseline gap-2">
				{/* The link's ::after covers the row, so a click anywhere opens the routine. */}
				<a
					href={hashForRoutines(routine.id)}
					className={cn(
						"max-w-full shrink-0 truncate font-medium outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring",
						!enabled && "text-muted-foreground",
					)}
				>
					{name}
				</a>
				<span className={cn("min-w-0 flex-1 truncate text-xs text-muted-foreground", task.kind === "command" && "font-mono")} title={preview}>
					{preview}
				</span>
			</div>
			<span className={cn("hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex", COLUMN.schedule)} title={schedule}>
				<Repeat aria-hidden className="size-3.5 shrink-0" />
				<span className="truncate">{schedule}</span>
			</span>
			<span className={cn("flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground", COLUMN.last)} title={last ? `${readTime(last.at)}: ${runWords(last)}` : undefined}>
				<RunDot run={last} />
				<span>
					<span className="sr-only">Last run </span>
					{last ? `${age(last.at, { compact: true, now })} ago` : "Never"}
				</span>
			</span>
			<span className={cn("hidden shrink-0 text-right text-xs tabular-nums sm:block", COLUMN.next, !enabled && "text-muted-foreground")}>
				<span className="sr-only">Next run: </span>
				{nextRunWords(routine, now)}
			</span>
			<span className="relative z-10 flex shrink-0 items-center opacity-0 group-hover/routine:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100">
				<RoutineActions routine={routine} disabled={!connected} onChange={onChange} onEdit={onEdit} />
			</span>
		</li>
	);
}

/** A group's sticky heading: its name and count, then the labels of the columns under it. */
function GroupHeading({ id, label, count }: { id: string; label: string; count: number }) {
	return (
		<h3 id={id} className="sticky top-0 z-20 flex h-9 items-center gap-3 rounded-md bg-muted px-2 text-xs font-medium">
			<span className="flex flex-1 items-center gap-2 pl-1 text-sm">
				{label}
				<span className="tabular-nums text-muted-foreground">{count}</span>
			</span>
			<span aria-hidden className="contents font-normal text-muted-foreground">
				<span className={cn("hidden shrink-0 lg:block", COLUMN.schedule)}>Schedule</span>
				<span className={cn("shrink-0", COLUMN.last)}>Last run</span>
				<span className={cn("hidden shrink-0 text-right sm:block", COLUMN.next)}>Next run</span>
				<span className="w-7 shrink-0" />
			</span>
		</h3>
	);
}

interface RoutinesPageProps {
	routines: Routine[];
	/** The routine whose settings and runs show, `null` for the list. */
	target: string | null;
	hosts: RosterHost[];
	/** The workspaces, which the editor's workspace picker offers. */
	workspaces: Workspace[];
	/** Where a new routine's sessions start until you pick another directory. */
	defaultCwd: string;
	connected: boolean;
}

/** Your routines, one routine's settings and runs, or the editor for a new one or an edit. */
export function RoutinesPage({ routines, target, hosts, workspaces, defaultCwd, connected }: RoutinesPageProps) {
	const { send } = useDashboardActions();
	const now = useMinute();
	const [editing, setEditing] = useState<{ draft: RoutineDraft; isNew: boolean } | null>(null);
	const onChange = (change: RoutineChange): void => send({ t: "routine", change });
	const startNew = (): void => setEditing({ draft: newDraft(crypto.randomUUID(), defaultCwd, readPinnedSkill()), isNew: true });
	const edit = (routine: Routine) => (): void => setEditing({ draft: draftOf(routine), isNew: false });

	if (editing) {
		return (
			<RoutineEditor
				key={editing.draft.id}
				initial={editing.draft}
				isNew={editing.isNew}
				workspaces={workspaces}
				connected={connected}
				onCancel={() => setEditing(null)}
				onSave={routine => {
					onChange({ op: "save", routine });
					setEditing(null);
					location.hash = hashForRoutines(routine.id);
				}}
			/>
		);
	}

	const shown = target === null ? undefined : routines.find(routine => routine.id === target);
	if (shown) return <RoutineDetail routine={shown} hosts={hosts} now={now} connected={connected} onChange={onChange} onEdit={edit(shown)} />;

	const paused = routines.filter(routine => !routine.enabled);
	const groups = [
		{ key: "active", label: "Active", routines: routines.filter(routine => routine.enabled) },
		{ key: "paused", label: "Paused", routines: paused },
	].filter(group => group.routines.length > 0);
	const meta =
		routines.length === 0
			? "Sessions and commands that run on a schedule"
			: `${routines.length} ${routines.length === 1 ? "routine" : "routines"}${paused.length > 0 ? `, ${paused.length} paused` : ""}`;
	return (
		<PageFrame
			title="Routines"
			meta={meta}
			actions={
				routines.length > 0 && (
					<Button variant="secondary" size="compact" leadingIcon={Plus} disabled={!connected} onClick={startNew}>
						New routine
					</Button>
				)
			}
		>
			{routines.length === 0 ? (
				<div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
					<span className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
						<Repeat aria-hidden className="size-5" />
					</span>
					<p className="text-sm font-medium">No routines yet</p>
					<p className="text-sm text-balance text-muted-foreground">
						A routine runs on one or more schedules. It starts a session with a prompt you write, or runs a command.
					</p>
					<Button size="compact" leadingIcon={Plus} disabled={!connected} onClick={startNew}>
						New routine
					</Button>
				</div>
			) : (
				<div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-2">
					{groups.map(group => (
						<section key={group.key} aria-labelledby={`routines-${group.key}`}>
							<GroupHeading id={`routines-${group.key}`} label={group.label} count={group.routines.length} />
							<ul aria-label={`${group.label} routines`} className="flex flex-col gap-0.5 py-1">
								{group.routines.map(routine => (
									<RoutineRow key={routine.id} routine={routine} now={now} connected={connected} onChange={onChange} onEdit={edit(routine)} />
								))}
							</ul>
						</section>
					))}
				</div>
			)}
		</PageFrame>
	);
}
