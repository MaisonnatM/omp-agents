/** A routine's editor: its name, Workspace, model, task, schedules, triggers, and whether every new Workspace gets a copy, saved together. */
import { type ReactNode, useId, useState } from "react";
import { COMMAND_TIME_LIMIT, type Routine, type RoutineSpec, TRIGGER_KINDS, type TriggerKind, type Weekday } from "../../../src/routines";
import { selectorOf } from "../../../src/shared/models";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { blankSchedule, type CommandPostChoice, dayName, type EveryUnit, type RoutineDraft, type ScheduleDraft, specOf, TRIGGER_WORDS, WEEK, WEEKDAYS } from "../../routines-model";
import { useDraftModelSelection } from "../../use-draft-model";
import { useSkills } from "../../use-skills";
import { PageFrame } from "../list-page";
import { Field, FIELD, TEXT_AREA } from "../form-field";
import { ModelPicker } from "../model-picker";
import { SkillPicker } from "../skill-picker";
import { ToggleSwitch } from "../toggle-switch";
import { DirectoryPicker } from "../workspace-picker";
import { CopiedFrom, EVERY_WORKSPACE } from "./routine-marks";

const UNITS: EveryUnit[] = ["minutes", "hours", "days"];

/** What each trigger watches, under its checkbox. */
const TRIGGER_HINTS: Record<TriggerKind, string> = {
	slack: "A mention or direct message you have not answered. Needs Slack signed in under Settings › Integrations.",
	"pull-request": "One of yours, or one waiting on your review, comes to need you: a review, failing checks, a conflict, comments to address, or ready to merge.",
};

/** The editor's choices of when a command posts its report, with what each means. */
const COMMAND_POST_CHOICES: { value: CommandPostChoice; label: string; hint: string }[] = [
	{ value: "every", label: "Every run", hint: "Each run posts a Board task." },
	{ value: "failures", label: "Only when it fails", hint: "A run that exits 0 keeps its output in the run list and posts nothing." },
	{ value: "changes", label: "When it fails or its output changes", hint: "A run that exits 0 with the same output as the last run posts nothing, so a check reaches the Board only on news." },
];

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
					<Select value={schedule.unit} onValueChange={next => next && set("unit", next)}>
						<SelectTrigger aria-label={`Unit${which}`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{UNITS.map(unit => (
								<SelectItem key={unit} value={unit}>
									{unit}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
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
	/** The Workspaces the routine may post in. */
	workspaces: Workspace[];
	/** The routine this one was copied from, while it still exists; `null` for none. */
	template: Routine | null;
	connected: boolean;
	/** A save is on its way to the server. */
	saving: boolean;
	onSave: (routine: RoutineSpec) => void;
	onCancel: () => void;
}

export function RoutineEditor({ initial, isNew, workspaces, template, connected, saving, onSave, onCancel }: RoutineEditorProps) {
	const [draft, setDraft] = useState(initial);
	const [tried, setTried] = useState(false);
	const id = useId();
	const models = useDraftModelSelection(draft.workspace || initial.workspace, { model: initial.launch?.model ?? null, thinking: initial.launch?.thinking ?? null });
	const set = <K extends keyof RoutineDraft>(key: K, value: RoutineDraft[K]): void => setDraft(current => ({ ...current, [key]: value }));
	const setSchedule = (index: number, schedule: ScheduleDraft): void =>
		setDraft(current => ({ ...current, schedules: current.schedules.map((item, i) => (i === index ? schedule : item)) }));
	const removeSchedule = (index: number): void =>
		setDraft(current => ({ ...current, schedules: current.schedules.filter((_, i) => i !== index) }));
	const toggleTrigger = (kind: TriggerKind): void =>
		setDraft(current => ({ ...current, triggers: current.triggers.includes(kind) ? current.triggers.filter(item => item !== kind) : [...current.triggers, kind] }));
	const skills = useSkills(draft.workspace || initial.workspace);
	const levelsKnown = models.levels !== null && models.picker.list.error === null;
	const savedModel = initial.launch?.model ?? null;
	const sameModel = (models.model && selectorOf(models.model)) === (savedModel && selectorOf(savedModel));
	const thinking = levelsKnown || !sameModel ? models.thinking : (initial.launch?.thinking ?? null);
	const skill = draft.launch?.skill ?? null;
	const launch = models.model || thinking || skill ? { model: models.model, thinking, skill } : null;
	const result = specOf({ ...draft, launch });

	return (
		<PageFrame title={isNew ? "New routine" : `Edit ${initial.name}`} meta="Posts a Board task in its Workspace on a schedule or a trigger while the dashboard runs">
			<form
				className="mx-auto w-full max-w-2xl space-y-6 px-6 py-6"
				onSubmit={event => {
					event.preventDefault();
					setTried(true);
					if ("ok" in result) onSave(result.ok);
				}}
			>
				{template && <CopiedFrom template={template} />}
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

				<Field label="Workspace" hint="Its Board gets the routine's Board tasks, and a command runs in its main checkout.">
					<div className="flex items-center gap-2">
						<DirectoryPicker cwd={draft.workspace} workspaces={workspaces} disabled={!connected} side="bottom" onPick={cwd => set("workspace", cwd)} />
					</div>
				</Field>

				<label className="flex items-start gap-2 text-sm">
					<span className="mt-0.5 flex">
						<ToggleSwitch checked={draft.everyWorkspace} onCheckedChange={next => set("everyWorkspace", next)} />
					</span>
					<span className="space-y-0.5">
						<span className="block">{EVERY_WORKSPACE}</span>
						<span className="block text-xs text-muted-foreground">Copies this routine into each Workspace you start working in. Each copy is its own routine.</span>
					</span>
				</label>

				<Field label="Model" hint="The session that takes each Board task starts on this model and effort, with this skill.">
					<div className="flex flex-wrap items-center gap-2">
						<ModelPicker {...models.picker} disabled={!connected} />
						<SkillPicker label="Skill" skills={skills} value={skill} onPick={next => set("launch", { model: null, thinking: null, ...draft.launch, skill: next })} />
					</div>
				</Field>

				<Field label="Task">
					<div className="space-y-3">
						<Choice name={`${id}-task`} checked={draft.task === "prompt"} label="Post instructions" onCheck={() => set("task", "prompt")}>
							<textarea
								aria-label="Instructions"
								value={draft.prompt}
								rows={4}
								placeholder="Summarize yesterday's commits on main."
								onChange={event => set("prompt", event.target.value)}
								className={TEXT_AREA}
							/>
							<p className="text-xs text-muted-foreground">Each run posts these as a Board task, with what a trigger saw, and a session takes it. While the routine's last Board task is open, a run replies on it.</p>
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
							<p className="text-xs text-muted-foreground">Runs with sh in the Workspace's main checkout, without an omp session, and stops after {COMMAND_TIME_LIMIT}. Its report goes into a Board task.</p>
							<textarea
								aria-label="Command instructions"
								value={draft.commandPrompt}
								rows={3}
								placeholder="Fix what failed, then mark the task done."
								onChange={event => set("commandPrompt", event.target.value)}
								className={TEXT_AREA}
							/>
							<p className="text-xs text-muted-foreground">Optional. The Board task carries these above the command's report.</p>
							<fieldset className="space-y-1.5 text-sm">
								<legend className="mb-1">Post the report</legend>
								{COMMAND_POST_CHOICES.map(({ value, label, hint }) => (
									<label key={value} className="flex items-start gap-2">
										<input type="radio" name={`${draft.id}-post`} checked={draft.post === value} onChange={() => set("post", value)} className="mt-0.5 size-4 shrink-0 accent-current" />
										<span className="space-y-0.5">
											<span className="block">{label}</span>
											<span className="block text-xs text-muted-foreground">{hint}</span>
										</span>
									</label>
								))}
							</fieldset>
						</Choice>
					</div>
				</Field>

				<Field label="Schedules" hint="Runs at the soonest of these. A missed time still starts one run. With a trigger, a routine needs no schedule.">
					<div className="space-y-3">
						{draft.schedules.map((schedule, index) => (
							<ScheduleEditor
								key={index}
								id={`${id}-schedule-${index}`}
								index={index}
								schedule={schedule}
								canRemove={draft.schedules.length > 1 || draft.triggers.length > 0}
								onChange={next => setSchedule(index, next)}
								onRemove={() => removeSchedule(index)}
							/>
						))}
						<Button type="button" variant="ghost" size="compact" onClick={() => set("schedules", [...draft.schedules, blankSchedule()])}>
							Add schedule
						</Button>
					</div>
				</Field>

				<Field label="Triggers" hint="Also runs when one of these sees something new, and tells the run what it saw. What happens while the dashboard is closed starts nothing.">
					<div className="space-y-3">
						{TRIGGER_KINDS.map(kind => (
							<label key={kind} className="flex items-start gap-2 text-sm">
								<input type="checkbox" checked={draft.triggers.includes(kind)} onChange={() => toggleTrigger(kind)} className="mt-0.5 size-4 shrink-0 accent-current" />
								<span className="space-y-0.5">
									<span className="block">{TRIGGER_WORDS[kind]}</span>
									<span className="block text-xs text-muted-foreground">{TRIGGER_HINTS[kind]}</span>
								</span>
							</label>
						))}
					</div>
				</Field>

				<div className="flex items-center gap-3 border-t border-border pt-4">
					<Button type="submit" disabled={!connected} loading={saving}>
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
