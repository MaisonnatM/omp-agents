import { ArrowLeft, Ellipsis, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { Routine, RoutineChange, RoutineRun, RoutineTask, RosterHost, View } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { modeOf, readTime, SPLIT_CLICK } from "../../labels";
import { readPinnedSkill } from "../../pinned-skill";
import { hashForRoutines } from "../../routing";
import { draftOf, lastRunWords, newDraft, nextRunWords, type RoutineDraft, runWords, scheduleWords, taskWords } from "../../routines-model";
import { useDashboardContext } from "../dashboard-context";
import { PageFrame } from "../list-sheet-page";
import { SessionChip } from "../session-chip";
import { statusLabel } from "../status-dot";
import { RoutineEditor } from "./routine-editor";

/** The time now, renewed each minute, so "Today" turns into "Tomorrow" and a passed slot reads as due. */
function useMinute(): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

interface RoutineActionsProps {
	routine: Routine;
	disabled: boolean;
	onChange: (change: RoutineChange) => void;
	onEdit: () => void;
	/** After **Delete** is confirmed and sent. */
	onDeleted?: () => void;
}

/** A routine's menu, **Run now**, **Pause** or **Resume**, **Edit**, and **Delete**, which asks first in its place. */
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
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={`More actions for ${name}`} title="More actions" disabled={disabled} />}>
				<Ellipsis />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<MenuItem onClick={() => onChange({ op: "run-now", id })}>
					<Play />
					Run now
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The view a run's session opens: live while it still runs, else its transcript. */
function sessionView(started: RoutineRun["started"][number], hosts: RosterHost[]): { view: View; host: RosterHost | null } {
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
	const { open } = useDashboardContext();
	return (
		<li className="space-y-1.5 px-3 py-2.5">
			<p className="flex items-baseline gap-2 text-sm">
				<span className="font-medium tabular-nums">{readTime(run.at)}</span>
				<span className="text-xs text-muted-foreground">{runWords(run, routine.task)}</span>
			</p>
			{run.started.length > 0 && (
				<div role="group" aria-label="Sessions it started" className="flex flex-wrap gap-1.5 text-xs">
					{run.started.map(started => {
						const { view, host } = sessionView(started, hosts);
						return (
							<SessionChip
								key={started.sessionId || started.instanceId}
								label={started.label}
								status={host?.status ?? null}
								title={`Open the session${host ? `, ${statusLabel(host.status)}` : ", which ended"} (${SPLIT_CLICK} to split)`}
								filled={false}
								onClick={event => open(view, modeOf(event))}
							/>
						);
					})}
				</div>
			)}
			{run.command && "output" in run.command && run.command.output.trim() !== "" && <CommandOutput output={run.command.output} />}
			{run.errors.length > 0 && (
				<ul aria-label="Errors" className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
					{run.errors.map((error, index) => (
						<li key={index} className="break-words">
							{error}
						</li>
					))}
				</ul>
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

/** What a routine's task row shows: the prompt or command whole, or the review action and what it starts. */
function TaskValue({ task }: { task: RoutineTask }) {
	switch (task.kind) {
		case "prompt":
			return <span className="whitespace-pre-wrap break-words">{task.prompt}</span>;
		case "command":
			return <code className="font-mono text-xs whitespace-pre-wrap break-words">{task.command}</code>;
		case "pull-requests":
			return (
				<>
					{taskWords(task)}
					<span className="block text-xs text-muted-foreground">One session for each pull request that asks for your review, once per new commit.</span>
				</>
			);
		default: {
			const unhandled: never = task;
			return unhandled;
		}
	}
}

/** One routine's settings, then its runs, newest first. */
function RoutineDetail({ routine, hosts, now, connected, onChange, onEdit }: DetailProps) {
	const { task } = routine;
	const settings: [string, ReactNode][] = [
		["Task", <TaskValue task={task} />],
		["Workspace", <span className="font-mono text-xs">{routine.cwd}</span>],
		["Schedule", scheduleWords(routine.schedule)],
		["Next run", nextRunWords(routine, now)],
	];
	// A command runs without a session, so it takes no skill.
	if (task.kind !== "command") settings.push(["Skill", routine.skill ?? "None"]);
	return (
		<PageFrame
			title={routine.name}
			meta={`${scheduleWords(routine.schedule)} · ${taskWords(task)}`}
			actions={
				<>
					<Button asChild variant="ghost" size="compact" leadingIcon={ArrowLeft}>
						<a href={hashForRoutines(null)}>All routines</a>
					</Button>
					<Button variant="secondary" size="compact" leadingIcon={Play} disabled={!connected} onClick={() => onChange({ op: "run-now", id: routine.id })}>
						Run now
					</Button>
					<RoutineActions
						routine={routine}
						disabled={!connected}
						onChange={onChange}
						onEdit={onEdit}
						onDeleted={() => {
							location.hash = hashForRoutines(null);
						}}
					/>
				</>
			}
		>
			<div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-6">
				<section aria-label={`Settings of ${routine.name}`}>
					<dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
						{settings.map(([term, value]) => (
							<div key={term} className="contents">
								<dt className="text-muted-foreground">{term}</dt>
								<dd className={cn(term === "Next run" && !routine.enabled && "text-muted-foreground")}>{value}</dd>
							</div>
						))}
					</dl>
				</section>
				<section aria-labelledby="routine-runs" className="space-y-2">
					<h3 id="routine-runs" className="text-sm font-medium">
						Runs
					</h3>
					{routine.runs.length === 0 ? (
						<p className="text-sm text-muted-foreground">No runs yet. Run now starts one.</p>
					) : (
						<ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{routine.runs.map(run => (
								<RunItem key={run.at} run={run} routine={routine} hosts={hosts} />
							))}
						</ul>
					)}
					<p className="text-xs text-muted-foreground">The last 10 runs stay here.</p>
				</section>
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

function RoutineRow({ routine, now, connected, onChange, onEdit }: RowProps) {
	const next = nextRunWords(routine, now);
	const last = routine.runs[0];
	return (
		<li className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
			<div className="min-w-0 flex-1 space-y-0.5">
				<a
					href={hashForRoutines(routine.id)}
					className="block truncate rounded-sm text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					{routine.name}
				</a>
				<p className="truncate text-xs text-muted-foreground">
					{scheduleWords(routine.schedule)} · {taskWords(routine.task)}
				</p>
			</div>
			<div className="shrink-0 space-y-0.5 text-right text-xs">
				<p className={cn(!routine.enabled && "text-muted-foreground")}>{routine.enabled ? `Next run: ${next}` : next}</p>
				<p className={cn(last && last.errors.length > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
					{last ? `Last run: ${lastRunWords(routine)}` : lastRunWords(routine)}
				</p>
			</div>
			<RoutineActions routine={routine} disabled={!connected} onChange={onChange} onEdit={onEdit} />
		</li>
	);
}

interface RoutinesPageProps {
	routines: Routine[];
	/** The routine whose settings and runs show, `null` for the list. */
	target: string | null;
	hosts: RosterHost[];
	/** Directories sessions ran in, which the editor's workspace picker offers. */
	workspaces: { cwd: string; cwdDisplay: string }[];
	/** Where a new routine's sessions start until you pick another directory. */
	defaultCwd: string;
	connected: boolean;
}

/** Your routines, one routine's settings and runs, or the editor for a new one or an edit. */
export function RoutinesPage({ routines, target, hosts, workspaces, defaultCwd, connected }: RoutinesPageProps) {
	const { send } = useDashboardContext();
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

	const paused = routines.filter(routine => !routine.enabled).length;
	const meta =
		routines.length === 0
			? "Sessions and commands that run on a schedule"
			: `${routines.length} ${routines.length === 1 ? "routine" : "routines"}${paused > 0 ? `, ${paused} paused` : ""}`;
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
				<div className="mx-auto max-w-md space-y-3 px-6 py-16 text-center">
					<p className="text-sm font-medium">No routines yet</p>
					<p className="text-sm text-muted-foreground">
						A routine runs on a schedule. It starts a session with a prompt you write, reviews the pull requests that ask for your review, or runs a command.
					</p>
					<Button size="compact" leadingIcon={Plus} disabled={!connected} onClick={startNew}>
						New routine
					</Button>
				</div>
			) : (
				<div className="mx-auto w-full max-w-3xl px-6 py-6">
					<ul aria-label="Routines" className="divide-y divide-border overflow-hidden rounded-md border border-border">
						{routines.map(routine => (
							<RoutineRow key={routine.id} routine={routine} now={now} connected={connected} onChange={onChange} onEdit={edit(routine)} />
						))}
					</ul>
				</div>
			)}
		</PageFrame>
	);
}
