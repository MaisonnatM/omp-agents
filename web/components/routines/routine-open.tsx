/** What an open row of a Bot's routines card shows: the picked run, the task whole, the schedule to change in place, and Edit and Delete. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { Routine, RoutineRun, RoutineTask, TriggerEvent, Weekday } from "../../../src/routines";
import { minutesOfTimeInput, timeInputValue } from "../../../src/shared/days";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { hashForBotRoutine, hashForBots } from "../../routing";
import {
	CADENCES,
	type Cadence,
	type CompactSchedule,
	cadenceOf,
	dayName,
	durationWords,
	pastRunWords,
	runDuration,
	runWords,
	scheduleOfCadence,
	schedulesWords,
	specWithSchedule,
	TRIGGER_WORDS,
	WEEK,
	withCadence,
} from "../../routines-model";
import { useDashboardActions } from "../dashboard-context";
import { FIELD } from "../form-field";
import { RunIcon } from "./routine-marks";

const HEADING = "text-xs font-medium text-muted-foreground";

/** Output longer than this many lines folds behind a disclosure. */
const FOLDED_OUTPUT_LINES = 20;

/** What a command printed, scrolling past a few lines, and folded when it is long. */
export function CommandOutput({ output }: { output: string }) {
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

/** What a trigger saw that started a run, each a link when it has one. */
export function TriggeredBy({ events }: { events: TriggerEvent[] }) {
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

/** The picked run: how it went, when, how long its command took, what started it, what it printed, and its errors. */
function RunReport({ run, latest, routine, botName, now }: { run: RoutineRun | undefined; latest: boolean; routine: Routine; botName: string; now: number }) {
	const headingId = useId();
	const heading = (
		<h4 id={headingId} className={HEADING}>
			{latest ? "Latest run" : "Run"}
		</h4>
	);
	if (!run) {
		return (
			<section aria-labelledby={headingId} className="space-y-1.5">
				{heading}
				<p className="text-sm text-muted-foreground">No runs yet. Run now starts one.</p>
			</section>
		);
	}
	const { outcome } = run;
	const output = outcome.kind === "command" && "output" in outcome.run ? outcome.run.output : "";
	const duration = runDuration(run);
	return (
		<section aria-labelledby={headingId} className="space-y-2">
			{heading}
			<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
				<RunIcon run={run} />
				{outcome.kind === "sent" ? (
					<a href={hashForBots(routine.botId)} className="font-medium underline-offset-2 hover:underline">
						Sent to {botName}
					</a>
				) : (
					<span className="font-medium">{runWords(run)}</span>
				)}
				<span className="text-muted-foreground tabular-nums">{pastRunWords(run.at, now)}</span>
				{duration !== null && <span className="text-muted-foreground tabular-nums">took {durationWords(duration)}</span>}
			</p>
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
		</section>
	);
}

/** The message or the command, whole. */
function Instructions({ task }: { task: RoutineTask }) {
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="space-y-1.5">
			<h4 id={headingId} className={HEADING}>
				Instructions
			</h4>
			{task.kind === "prompt" ? (
				<p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{task.prompt}</p>
			) : (
				<code className="block rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{task.command}</code>
			)}
		</section>
	);
}

const CADENCE_LIST = Object.keys(CADENCES) as Cadence[];

/**
 * The routine's schedule as one cadence to pick, with its time and, weekly, its day; each change saves at once.
 * A custom routine names its schedules with no cadence picked, and picking one replaces them.
 */
function ScheduleEditor({ routine, disabled }: { routine: Routine; disabled: boolean }) {
	const headingId = useId();
	const { send } = useDashboardActions();
	const compact = cadenceOf(routine.schedules);
	const save = (next: CompactSchedule): void =>
		send({ t: "routine", change: { op: "save", routine: specWithSchedule(routine, scheduleOfCadence(next)) } });
	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h4 id={headingId} className={HEADING}>
				Schedule
			</h4>
			<div className="flex flex-wrap items-center gap-2">
				<RadioGroup
					aria-labelledby={headingId}
					value={compact?.cadence ?? null}
					disabled={disabled}
					onValueChange={value => {
						const cadence = CADENCE_LIST.find(option => option === value);
						if (cadence) save(withCadence(compact, cadence));
					}}
					className="flex w-fit gap-0.5 rounded-lg bg-input/40 p-0.5"
				>
					{CADENCE_LIST.map(cadence => (
						<Radio.Root
							key={cadence}
							value={cadence}
							className="inline-flex h-6 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors select-none hover:bg-background/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-background data-[checked]:text-foreground data-[checked]:shadow-xs/10 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 motion-reduce:transition-none dark:hover:bg-input/32 dark:data-[checked]:bg-input/72"
						>
							{CADENCES[cadence].label}
						</Radio.Root>
					))}
				</RadioGroup>
				{compact && compact.cadence !== "hourly" && (
					<input
						type="time"
						aria-label="Time"
						disabled={disabled}
						value={timeInputValue(compact.time.hour * 60 + compact.time.minute)}
						onChange={event => {
							const minutes = minutesOfTimeInput(event.target.value);
							if (minutes !== null) save({ ...compact, time: { hour: Math.floor(minutes / 60), minute: minutes % 60 } });
						}}
						className={cn(FIELD, "h-7 w-auto tabular-nums")}
					/>
				)}
				{compact?.cadence === "weekly" && (
					<Select value={compact.day} disabled={disabled} onValueChange={(day: Weekday | null) => day !== null && save({ ...compact, day })}>
						<SelectTrigger aria-label="Day">
							<SelectValue>{(day: Weekday) => dayName(day)}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{WEEK.map(day => (
								<SelectItem key={day} value={day}>
									{dayName(day)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>
			{!compact && (
				<p className="text-sm">
					{routine.schedules.length > 0 ? schedulesWords(routine) : "No schedule"}
					<span className="text-muted-foreground">. Picking a cadence replaces {routine.schedules.length > 1 ? "these schedules" : "this"}.</span>
				</p>
			)}
			{routine.triggers.length > 0 && (
				<ul aria-label="Triggers" className="space-y-0.5 text-sm">
					{routine.triggers.map(({ kind }) => (
						<li key={kind}>{TRIGGER_WORDS[kind]}</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Edit, the full editor, and Delete, which asks first in its place, then leaves the card with no row open. */
function Footer({ routine, disabled }: { routine: Routine; disabled: boolean }) {
	const { send } = useDashboardActions();
	const [confirming, setConfirming] = useState(false);
	const { id, botId, name } = routine;
	if (confirming) {
		return (
			<div role="group" aria-label={`Delete ${name}?`} className="flex flex-wrap items-center justify-end gap-2 text-xs">
				<span>Delete it and its runs?</span>
				<Button
					size="compact"
					disabled={disabled}
					onClick={() => {
						send({ t: "routine", change: { op: "remove", id } });
						location.hash = hashForBotRoutine(botId, { kind: "list" });
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
		<div className="flex items-center justify-end gap-1">
			<Button asChild variant="ghost" size="compact" leadingIcon={Pencil}>
				<a href={hashForBotRoutine(botId, { kind: "edit", id })}>Edit</a>
			</Button>
			<Button {...activityControl("bots.routine.delete")} variant="ghost" size="compact" leadingIcon={Trash2} disabled={disabled} onClick={() => setConfirming(true)}>
				Delete
			</Button>
		</div>
	);
}

interface RoutineOpenProps {
	routine: Routine;
	/** The run the row shows, the latest unless a tick picked another; `undefined` before the first run. */
	run: RoutineRun | undefined;
	botName: string;
	connected: boolean;
	now: number;
}

export function RoutineOpen({ routine, run, botName, connected, now }: RoutineOpenProps) {
	return (
		<div className="space-y-5 pt-3">
			<RunReport run={run} latest={run === routine.runs[0]} routine={routine} botName={botName} now={now} />
			<Instructions task={routine.task} />
			<ScheduleEditor routine={routine} disabled={!connected} />
			<Footer routine={routine} disabled={!connected} />
		</div>
	);
}
