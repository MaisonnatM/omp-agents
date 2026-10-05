import { type ReactNode, useId, useState } from "react";
import { PULL_REQUEST_ACTIONS } from "../../../src/pull-request-actions";
import { ROUTINE_PR_ACTIONS, type RoutinePullRequestAction, type Weekday } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dayName, type EveryUnit, type RoutineDraft, type RoutineSpec, specOf, WEEK, WEEKDAYS } from "../../routines-model";
import { useSkills } from "../../use-skills";
import { PageFrame } from "../list-sheet-page";
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

interface RoutineEditorProps {
	initial: RoutineDraft;
	isNew: boolean;
	/** Directories sessions ran in, which the workspace picker offers. */
	workspaces: { cwd: string; cwdDisplay: string }[];
	connected: boolean;
	onSave: (routine: RoutineSpec) => void;
	onCancel: () => void;
}

/** A routine's name, workspace, task, schedule, and skill, saved together. */
export function RoutineEditor({ initial, isNew, workspaces, connected, onSave, onCancel }: RoutineEditorProps) {
	const [draft, setDraft] = useState(initial);
	const [tried, setTried] = useState(false);
	const skills = useSkills(draft.cwd || "~");
	const id = useId();
	const set = <K extends keyof RoutineDraft>(key: K, value: RoutineDraft[K]): void => setDraft(current => ({ ...current, [key]: value }));
	const toggleDay = (day: Weekday): void =>
		setDraft(current => ({ ...current, days: current.days.includes(day) ? current.days.filter(d => d !== day) : [...current.days, day] }));
	const result = specOf(draft);
	const action = PULL_REQUEST_ACTIONS[draft.action];

	return (
		<PageFrame title={isNew ? "New routine" : `Edit ${initial.name}`} meta="Starts sessions on a schedule while the dashboard runs">
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
						placeholder="Morning reviews"
						onChange={event => set("name", event.target.value)}
						className={cn(FIELD, "w-full")}
					/>
				</Field>

				<Field label="Workspace" hint="Its sessions start in this directory.">
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
						<Choice name={`${id}-task`} checked={draft.task === "pull-requests"} label="Review pull requests" onCheck={() => set("task", "pull-requests")}>
							<select
								aria-label="Review action"
								value={draft.action}
								onChange={event => set("action", event.target.value as RoutinePullRequestAction)}
								className={FIELD}
							>
								{ROUTINE_PR_ACTIONS.map(value => (
									<option key={value} value={value}>
										{PULL_REQUEST_ACTIONS[value].label}
									</option>
								))}
							</select>
							<p className="text-xs text-muted-foreground">
								{action.description}. It starts one for each pull request that asks for your review, once per new commit, and posts nothing on GitHub.
							</p>
						</Choice>
					</div>
				</Field>

				<Field label="Schedule">
					<div className="space-y-3">
						<Choice name={`${id}-schedule`} checked={draft.schedule === "every"} label="Repeat" onCheck={() => set("schedule", "every")}>
							<div className="flex items-center gap-2 text-sm">
								Every
								<input
									type="number"
									inputMode="numeric"
									min={1}
									aria-label="How many"
									value={draft.amount}
									onChange={event => set("amount", event.target.value)}
									className={cn(FIELD, "w-20 tabular-nums")}
								/>
								<select aria-label="Unit" value={draft.unit} onChange={event => set("unit", event.target.value as EveryUnit)} className={FIELD}>
									{UNITS.map(unit => (
										<option key={unit} value={unit}>
											{unit}
										</option>
									))}
								</select>
							</div>
							<p className="text-xs text-muted-foreground">Counted from its last run.</p>
						</Choice>
						<Choice name={`${id}-schedule`} checked={draft.schedule === "weekly"} label="On chosen days" onCheck={() => set("schedule", "weekly")}>
							<div role="group" aria-label="Days" className="flex flex-wrap gap-1">
								{WEEK.map(day => (
									<button
										key={day}
										type="button"
										aria-pressed={draft.days.includes(day)}
										onClick={() => toggleDay(day)}
										className={cn(
											"h-7 w-11 rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
											draft.days.includes(day) ? "bg-foreground text-background" : "ring-1 ring-inset ring-border hover:bg-accent",
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
									<input type="time" value={draft.time} onChange={event => set("time", event.target.value)} className={cn(FIELD, "tabular-nums")} />
								</label>
							</div>
						</Choice>
					</div>
				</Field>

				<Field label="Skill" hint="Each session's first message goes through this skill.">
					<SkillPicker label="Skill" skills={skills} value={draft.skill} onPick={skill => set("skill", skill)} />
				</Field>

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
