import { type ReactNode, useId, useState } from "react";
import { COMMAND_TIME_LIMIT } from "../../../src/routines";
import type { Weekday } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { blankSchedule, dayName, type EveryUnit, type RoutineDraft, type RoutineSpec, type ScheduleDraft, specOf, WEEK, WEEKDAYS } from "../../routines-model";
import { useSkills } from "../../use-skills";
import { PageFrame } from "../list-page";
import { DirectoryPicker } from "../new-session";
import { SkillPicker } from "../skill-picker";

const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const UNITS: EveryUnit[] = ["minutes", "hours", "days"];

/** A labeled part of the form; `hint` explains it under the control. */
function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
	const Label = htmlFor ? "label" : "p";
	return (
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor} className="block text-sm font-medium">
				{label}
			</Label>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

/** One choice of a radio group, with the controls it enables under it. */
function Choice({ name, checked, label, onCheck, children }: { name: string; checked: boolean; label: string; onCheck: () => void; children: ReactNode }) {
	return (
		<div className="space-y-2">
			<label className="flex items-center gap-2 text-sm">
				<input type="radio" name={name} checked={checked} onChange={onCheck} className="size-4 accent-current" />
				{label}
			</label>
			<fieldset disabled={!checked} className={cn("ml-6 space-y-2", !checked && "opacity-50")}>
				{children}
			</fieldset>
		</div>
	);
}

/** One schedule: an interval, or days and a time. Remove stays hidden while it is the only one. */
function ScheduleEditor({
	id,
	index,
	schedule,
	canRemove,
	onChange,
	onRemove,
}: {
	id: string;
	index: number;
	schedule: ScheduleDraft;
	canRemove: boolean;
	onChange: (schedule: ScheduleDraft) => void;
	onRemove: () => void;
}) {
	const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]): void => onChange({ ...schedule, [key]: value });
	const toggleDay = (day: Weekday): void => set("days", schedule.days.includes(day) ? schedule.days.filter(item => item !== day) : [...schedule.days, day]);
	const which = canRemove ? ` ${index + 1}` : "";
	return (
		<div className="space-y-3 rounded-md border border-border p-3">
			{canRemove && (
				<div className="flex justify-end">
					<Button type="button" variant="ghost" size="compact" onClick={onRemove}>
						Remove
					</Button>
				</div>
			)}
			<Choice name={id} checked={schedule.kind === "every"} label="Repeat" onCheck={() => set("kind", "every")}>
				<div className="flex items-center gap-2 text-sm">
					Every
					<input
						type="number"
						inputMode="numeric"
						min={1}
						aria-label={`How many${which}`}
						value={schedule.amount}
						onChange={event => set("amount", event.target.value)}
						className={cn(FIELD, "w-20 tabular-nums")}
					/>
					<select aria-label={`Unit${which}`} value={schedule.unit} onChange={event => set("unit", event.target.value as EveryUnit)} className={FIELD}>
						{UNITS.map(unit => (
							<option key={unit} value={unit}>
								{unit}
							</option>
						))}
					</select>
				</div>
				<p className="text-xs text-muted-foreground">Counted from its last run. Every schedule shares that run.</p>
			</Choice>
			<Choice name={id} checked={schedule.kind === "weekly"} label="On chosen days" onCheck={() => set("kind", "weekly")}>
				<div role="group" aria-label={`Days${which}`} className="flex flex-wrap gap-1">
					{WEEK.map(day => (
						<button
							key={day}
							type="button"
							aria-pressed={schedule.days.includes(day)}
							onClick={() => toggleDay(day)}
							className={cn(
								"h-7 w-11 rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
								schedule.days.includes(day) ? "bg-foreground text-background" : "ring-1 ring-inset ring-border hover:bg-accent",
							)}
						>
							{dayName(day)}
						</button>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<Button type="button" variant="ghost" size="compact" onClick={() => set("days", [...WEEKDAYS])}>
						Weekdays
					</Button>
					<Button type="button" variant="ghost" size="compact" onClick={() => set("days", [...WEEK])}>
						Every day
					</Button>
					<label className="ml-auto flex items-center gap-2">
						At
						<input type="time" aria-label={`Time${which}`} value={schedule.time} onChange={event => set("time", event.target.value)} className={cn(FIELD, "tabular-nums")} />
					</label>
				</div>
			</Choice>
		</div>
	);
}

interface RoutineEditorProps {
	initial: RoutineDraft;
	isNew: boolean;
	/** Directories sessions ran in, which the workspace picker offers. */
	workspaces: { cwd: string; cwdDisplay: string }[];
	connected: boolean;
	onSave: (routine: RoutineSpec) => void;
	onCancel: () => void;
}

/** A routine's name, workspace, task, schedules, and skill, saved together. */
export function RoutineEditor({ initial, isNew, workspaces, connected, onSave, onCancel }: RoutineEditorProps) {
	const [draft, setDraft] = useState(initial);
	const [tried, setTried] = useState(false);
	const skills = useSkills(draft.cwd || "~");
	const id = useId();
	const set = <K extends keyof RoutineDraft>(key: K, value: RoutineDraft[K]): void => setDraft(current => ({ ...current, [key]: value }));
	const setSchedule = (index: number, schedule: ScheduleDraft): void =>
		setDraft(current => ({ ...current, schedules: current.schedules.map((item, i) => (i === index ? schedule : item)) }));
	const removeSchedule = (index: number): void =>
		setDraft(current => ({ ...current, schedules: current.schedules.filter((_, i) => i !== index) }));
	const result = specOf(draft);

	return (
		<PageFrame title={isNew ? "New routine" : `Edit ${initial.name}`} meta="Runs on a schedule while the dashboard runs">
			<form
				className="mx-auto w-full max-w-2xl space-y-6 px-6 py-6"
				onSubmit={event => {
					event.preventDefault();
					setTried(true);
					if ("ok" in result) onSave(result.ok);
				}}
			>
				<Field label="Name" htmlFor={`${id}-name`}>
					<input
						id={`${id}-name`}
						autoFocus
						value={draft.name}
						placeholder="Morning notes"
						onChange={event => set("name", event.target.value)}
						className={cn(FIELD, "w-full")}
					/>
				</Field>

				<Field label="Workspace" hint={draft.task === "command" ? "The command runs in this directory." : "Its sessions start in this directory."}>
					<DirectoryPicker cwd={draft.cwd} workspaces={workspaces} disabled={false} side="bottom" onPick={cwd => set("cwd", cwd)} />
				</Field>

				<Field label="Task">
					<div className="space-y-3">
						<Choice name={`${id}-task`} checked={draft.task === "prompt"} label="Run a prompt" onCheck={() => set("task", "prompt")}>
							<textarea
								aria-label="Prompt"
								value={draft.prompt}
								rows={4}
								placeholder="Summarize yesterday's commits on main."
								onChange={event => set("prompt", event.target.value)}
								className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</Choice>
						<Choice name={`${id}-task`} checked={draft.task === "command"} label="Run a command" onCheck={() => set("task", "command")}>
							<textarea
								aria-label="Command"
								value={draft.command}
								rows={3}
								spellCheck={false}
								autoCapitalize="off"
								autoCorrect="off"
								placeholder="git worktree prune"
								onChange={event => set("command", event.target.value)}
								className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
							<p className="text-xs text-muted-foreground">Runs with sh in the workspace, without an omp session. Stopped after {COMMAND_TIME_LIMIT}.</p>
						</Choice>
					</div>
				</Field>

				<Field label="Schedules" hint="Runs at the soonest of these. A missed time still starts one run.">
					<div className="space-y-3">
						{draft.schedules.map((schedule, index) => (
							<ScheduleEditor
								key={index}
								id={`${id}-schedule-${index}`}
								index={index}
								schedule={schedule}
								canRemove={draft.schedules.length > 1}
								onChange={next => setSchedule(index, next)}
								onRemove={() => removeSchedule(index)}
							/>
						))}
						<Button type="button" variant="ghost" size="compact" onClick={() => set("schedules", [...draft.schedules, blankSchedule()])}>
							Add schedule
						</Button>
					</div>
				</Field>

				{draft.task !== "command" && (
					<Field label="Skill" hint="Each session's first message goes through this skill.">
						<SkillPicker label="Skill" skills={skills} value={draft.skill} onPick={skill => set("skill", skill)} />
					</Field>
				)}

				<div className="flex items-center gap-3 border-t border-border pt-4">
					<Button type="submit" disabled={!connected}>
						{isNew ? "Create routine" : "Save routine"}
					</Button>
					<Button type="button" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					{tried && "fix" in result && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							{result.fix}
						</p>
					)}
				</div>
			</form>
		</PageFrame>
	);
}
