/**
 * A project's plan as its page's checklist: how far it is, the step up next to mark done or start a session on, and each top-level step as a group to fold
 * with its sub-steps and their count, open groups first. A toolbar that stays on screen hides done steps, folds every
 * group, and picks several steps with **Select** to hand to a new session with **Start session**; a step's play button
 * hands it alone.
 */
import { IconCheckmark1, IconChevronRightSmall, IconPlay, IconPlusSmall } from "central-icons";
import { useState } from "react";
import { collapseSpaces } from "../../../src/shared/collapse-spaces";
import { type Project, type ProjectStep, stepNumbers } from "../../../src/shared/projects";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { appendToComposer, NEW_DRAFT_KEY } from "../../composer-drafts";
import { hashForNewSession } from "../../routing";
import { offerUndo } from "../toaster";
import { AddLine, EmptyNote, type OnProjectChange, PROJECT_UNDO, RemoveButton, RowAction } from "./parts";
import { StepInput } from "./step-input";
import { stepsPrompt } from "./steps-prompt";

/** The steps picked for a new session, or `null` while the plan is not selecting. */
type Selection = ReadonlySet<string> | null;

/** A top-level step with its sub-steps; it is complete once it and every sub-step are done. */
interface StepGroup {
	step: ProjectStep;
	subSteps: ProjectStep[];
	done: number;
	complete: boolean;
}

/** The plan's groups in its order, the complete ones last. */
function stepGroups(steps: readonly ProjectStep[]): StepGroup[] {
	const groups = steps
		.filter(step => step.parentId === undefined)
		.map((step): StepGroup => {
			const subSteps = steps.filter(each => each.parentId === step.id);
			const done = subSteps.filter(each => each.done).length;
			return { step, subSteps, done, complete: step.done && done === subSteps.length };
		});
	return [...groups.filter(group => !group.complete), ...groups.filter(group => group.complete)];
}

/** The first step left to do with no sub-step left under it, in the first open group: its first open sub-step, else the step itself. */
function upNext(groups: readonly StepGroup[]): { group: StepGroup; step: ProjectStep } | null {
	const group = groups.find(each => !each.complete);
	if (!group) return null;
	return { group, step: group.subSteps.find(each => !each.done) ?? group.step };
}

export function Plan({ project, readOnly, onChange }: { project: Project; readOnly: boolean; onChange: OnProjectChange }) {
	const projectId = project.id;
	const groups = stepGroups(project.steps);
	const next = upNext(groups);
	const total = project.steps.length;
	const doneCount = project.steps.filter(step => step.done).length;
	const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(next ? [next.group.step.id] : []));
	const [hideDone, setHideDone] = useState(false);
	const [selection, setSelection] = useState<Selection>(null);
	const [addingUnder, setAddingUnder] = useState<string | null>(null);
	const numbers = stepNumbers(project.steps);
	const selecting = selection !== null && !readOnly;
	const shown = hideDone ? groups.filter(group => !group.complete) : groups;
	const foldable = shown.filter(group => group.subSteps.length > 0);
	const allExpanded = foldable.length > 0 && foldable.every(group => expanded.has(group.step.id));
	const subStepsOf = (step: ProjectStep): ProjectStep[] => project.steps.filter(each => each.parentId === step.id);
	const withSubSteps = (step: ProjectStep): string[] => [step.id, ...subStepsOf(step).map(each => each.id)];
	const remove = (step: ProjectStep): void => {
		const removed = [step, ...subStepsOf(step)];
		onChange({ op: "remove-step", projectId, stepId: step.id });
		offerUndo(PROJECT_UNDO, `Removed “${step.text}”`, () => {
			for (const each of removed) {
				onChange({ op: "add-step", projectId, stepId: each.id, text: each.text, ...(each.parentId ? { parentId: each.parentId } : {}) });
				if (each.done) onChange({ op: "set-step", projectId, stepId: each.id, done: true });
			}
		});
	};
	// Picking a step picks its sub-steps with it, so a session handed a step gets the whole of it.
	const toggle = (step: ProjectStep): void =>
		setSelection(current => {
			const picked = new Set(current);
			const on = !picked.has(step.id);
			for (const id of withSubSteps(step)) on ? picked.add(id) : picked.delete(id);
			return picked;
		});
	const startSession = (stepIds: ReadonlySet<string>): void => {
		const prompt = stepsPrompt(project, stepIds);
		if (prompt === null) return;
		appendToComposer(NEW_DRAFT_KEY, prompt);
		setSelection(null);
		location.hash = hashForNewSession({ projectId });
	};
	const setOpen = (id: string, open: boolean): void =>
		setExpanded(current => {
			const next = new Set(current);
			open ? next.add(id) : next.delete(id);
			return next;
		});
	const row = (step: ProjectStep, group: StepGroup | null) => (
		<PlanRow
			key={step.id}
			projectId={projectId}
			step={step}
			number={numbers.get(step.id) ?? ""}
			readOnly={readOnly}
			picked={selecting ? (selection?.has(step.id) ?? false) : null}
			onPick={() => toggle(step)}
			onChange={onChange}
			onRemove={() => remove(step)}
			onAddSubStep={
				group
					? () => {
							setOpen(step.id, true);
							setAddingUnder(step.id);
						}
					: null
			}
			onStart={() => startSession(new Set(withSubSteps(step)))}
			fold={
				group && group.subSteps.length > 0
					? { open: expanded.has(step.id), done: group.done, total: group.subSteps.length, onToggle: () => setOpen(step.id, !expanded.has(step.id)) }
					: null
			}
		/>
	);
	return (
		<>
			{total > 0 && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<div className="flex items-baseline gap-2">
							<span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">{percent}%</span>
							<span className="text-sm text-muted-foreground">done</span>
							<span className="ml-auto text-sm text-muted-foreground tabular-nums">
								{doneCount} of {total} steps
							</span>
						</div>
						<div
							role="progressbar"
							aria-label="Plan progress"
							aria-valuemin={0}
							aria-valuemax={total}
							aria-valuenow={doneCount}
							aria-valuetext={`${doneCount} of ${total} steps done`}
							className="h-2 overflow-hidden rounded-full bg-muted"
						>
							<div className={cn("h-full rounded-full transition-[width] duration-300", readOnly ? "bg-muted-foreground" : "bg-success")} style={{ width: `${percent}%` }} />
						</div>
					</div>
					{next && (
						<section aria-label="Up next" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-accent/40 py-3 pr-3 pl-4 @xl:flex-row @xl:items-center">
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="truncate text-xs text-muted-foreground">
									Up next · {next.step === next.group.step ? `Step ${numbers.get(next.step.id) ?? ""}` : `${numbers.get(next.step.id) ?? ""} in ${next.group.step.text}`}
								</span>
								<span className="text-sm font-medium text-pretty break-words">{next.step.text}</span>
							</div>
							{!readOnly && (
								<div className="flex shrink-0 items-center gap-2">
									<Button
										{...activityControl("projects.step.toggle")}
										variant="outline"
										size="compact"
										leadingIcon={IconCheckmark1}
										onClick={() => {
											const after = upNext(stepGroups(project.steps.map(step => (step.id === next.step.id ? { ...step, done: true } : step))));
											if (after) setOpen(after.group.step.id, true);
											onChange({ op: "set-step", projectId, stepId: next.step.id, done: true });
										}}
									>
										Mark done
									</Button>
									<Button {...activityControl("projects.step.start")} size="compact" leadingIcon={IconPlay} onClick={() => startSession(new Set(withSubSteps(next.step)))}>
										Start session
									</Button>
								</div>
							)}
						</section>
					)}
				</div>
			)}
			<section aria-label="Plan" className="flex min-w-0 flex-col">
				<div className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-background">
					<h2 className="text-sm font-semibold">Plan</h2>
					{selecting ? (
						<>
							<span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{selection.size === 0 ? "Pick the steps a new session works on" : `${selection.size} selected`}</span>
							<div className="ml-auto flex shrink-0 items-center gap-2">
								<Button {...activityControl("projects.step.select")} variant="ghost" size="xs" aria-pressed onClick={() => setSelection(null)}>
									Cancel
								</Button>
								<Button {...activityControl("projects.step.start")} size="compact" leadingIcon={IconPlay} disabled={selection.size === 0} onClick={() => startSession(selection)}>
									Start session
								</Button>
							</div>
						</>
					) : (
						total > 0 && (
							<div className="ml-auto flex items-center gap-1">
								{foldable.length > 0 && (
									<Button variant="ghost" size="xs" onClick={() => setExpanded(allExpanded ? new Set() : new Set(foldable.map(group => group.step.id)))}>
										{allExpanded ? "Collapse all" : "Expand all"}
									</Button>
								)}
								<Button variant="ghost" size="xs" aria-pressed={hideDone} className="aria-pressed:bg-accent" onClick={() => setHideDone(!hideDone)}>
									Hide done
									<span className="ml-1.5 text-muted-foreground tabular-nums">{doneCount}</span>
								</Button>
								{!readOnly && (
									<Button {...activityControl("projects.step.select")} variant="outline" size="xs" onClick={() => setSelection(new Set())}>
										Select
									</Button>
								)}
							</div>
						)
					)}
				</div>
				<div className="mt-1 flex flex-col overflow-hidden rounded-xl border border-border bg-background">
					{shown.length === 0 ? (
						<EmptyNote>
							{total === 0 ? "Break the goal into steps. Every session in the project reads the plan at its start and ticks what it finishes." : "Every step is done."}
						</EmptyNote>
					) : (
						<ul className="flex flex-col">
							{shown.map(group => {
								const open = expanded.has(group.step.id) || addingUnder === group.step.id;
								const subSteps = hideDone ? group.subSteps.filter(step => !step.done) : group.subSteps;
								return (
									<li key={group.step.id} className="flex flex-col border-b border-border last:border-b-0">
										<ul className="flex flex-col">
											{row(group.step, group)}
											{open && subSteps.map(step => row(step, null))}
											{addingUnder === group.step.id && !selecting && (
												<AddSubStep onAdd={text => onChange({ op: "add-step", projectId, stepId: crypto.randomUUID(), text, parentId: group.step.id })} onClose={() => setAddingUnder(null)} />
											)}
										</ul>
									</li>
								);
							})}
						</ul>
					)}
					{!readOnly && !selecting && <AddLine control="projects.step.add" label="Add a step" onAdd={text => onChange({ op: "add-step", projectId, stepId: crypto.randomUUID(), text })} />}
				</div>
			</section>
		</>
	);
}

/** A group header's fold: whether its sub-steps show, and how many of them are done. */
interface Fold {
	open: boolean;
	done: number;
	total: number;
	onToggle: () => void;
}

interface PlanRowProps {
	projectId: string;
	step: ProjectStep;
	number: string;
	readOnly: boolean;
	/** Whether the step is picked while the plan is selecting, else `null`, when its box ticks it. */
	picked: boolean | null;
	onPick: () => void;
	onChange: OnProjectChange;
	onRemove: () => void;
	/** Opens the field that adds a sub-step under it; `null` for a sub-step, which holds none. */
	onAddSubStep: (() => void) | null;
	/** Starts a session in the project on this step and its sub-steps. */
	onStart: () => void;
	/** The fold of a top-level step that has sub-steps, else `null`. */
	fold: Fold | null;
}

/**
 * A step of the plan: a box that ticks it, or picks it while the plan is selecting, its text, which a click edits, and
 * its number in the plan; a top-level step heads its group, with a chevron that folds it and its sub-steps' count.
 */
function PlanRow({ projectId, step, number, readOnly, picked, onPick, onChange, onRemove, onAddSubStep, onStart, fold }: PlanRowProps) {
	const [editing, setEditing] = useState(false);
	const selecting = picked !== null;
	const save = (text: string): void => {
		const line = collapseSpaces(text);
		if (line && line !== step.text) onChange({ op: "edit-step", projectId, stepId: step.id, text: line });
		setEditing(false);
	};
	const subStep = step.parentId !== undefined;
	return (
		<li
			className={cn(
				"group/item flex min-h-10 items-start gap-3 py-2 pr-4 text-sm leading-snug hover:bg-accent/50",
				subStep ? "border-t border-border/50 pl-[4.5rem]" : "min-h-11 py-2.5 pl-3",
				picked && "bg-accent/50",
			)}
		>
			{!subStep &&
				(fold ? (
					<button
						type="button"
						aria-expanded={fold.open}
						aria-label={`${fold.open ? "Hide" : "Show"} the sub-steps of “${step.text}”`}
						onClick={fold.onToggle}
						className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4"
					>
						<IconChevronRightSmall className={cn("transition-transform duration-150", fold.open && "rotate-90")} />
					</button>
				) : (
					<span className="-mr-1 size-5 shrink-0" aria-hidden />
				))}
			{selecting ? (
				<button
					{...activityControl("projects.step.select")}
					type="button"
					role="checkbox"
					aria-checked={picked}
					aria-label={`${picked ? "Unselect" : "Select"} “${step.text}”`}
					onClick={onPick}
					className={cn(
						"inline-flex size-5 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring",
						picked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
					)}
				>
					{picked && <IconCheckmark1 className="size-3.5" />}
				</button>
			) : (
				<button
					{...activityControl("projects.step.toggle")}
					type="button"
					role="checkbox"
					aria-checked={step.done}
					aria-label={`${step.done ? "Untick" : "Tick"} “${step.text}”`}
					disabled={readOnly}
					onClick={() => onChange({ op: "set-step", projectId, stepId: step.id, done: !step.done })}
					className={cn(
						"inline-flex size-5 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
						step.done ? "border-foreground bg-foreground text-background" : "border-border bg-background enabled:hover:bg-accent",
					)}
				>
					{step.done && <IconCheckmark1 className="size-3.5" />}
				</button>
			)}
			{editing && !selecting ? (
				<StepInput
					initial={step.text}
					label="Step"
					onKey={(key, text) => {
						if (key === "enter") save(text);
						else if (key === "escape") setEditing(false);
						else return false;
						return true;
					}}
					onLeave={save}
				/>
			) : (
				<button
					{...activityControl(selecting ? "projects.step.select" : "projects.step.edit")}
					type="button"
					disabled={readOnly}
					onClick={() => (selecting ? onPick() : setEditing(true))}
					className={cn("min-w-0 flex-1 rounded-sm text-left break-words", !subStep && "font-medium", step.done && "font-normal text-muted-foreground line-through")}
				>
					{step.text}
				</button>
			)}
			{!readOnly && !editing && !selecting && (
				<>
					{!step.done && <RowAction control="projects.step.start" tooltip="Start a session on this step" label={`Start a session on “${step.text}”`} icon={IconPlay} onClick={onStart} />}
					{onAddSubStep && <RowAction control="projects.step.add-sub" tooltip="Add a sub-step" label={`Add a sub-step under “${step.text}”`} icon={IconPlusSmall} onClick={onAddSubStep} />}
					<RemoveButton control="projects.step.remove" label={`Remove the step “${step.text}”${onAddSubStep ? " and its sub-steps" : ""}`} onClick={onRemove} />
				</>
			)}
			{fold ? (
				<span className="flex h-5 w-24 shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground tabular-nums">
					<span className="h-1.5 w-12 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
						<span className="block h-full rounded-full bg-success" style={{ width: `${(fold.done / fold.total) * 100}%` }} />
					</span>
					{fold.done}/{fold.total}
				</span>
			) : (
				<span className="w-24 shrink-0 pt-px text-right text-xs text-muted-foreground tabular-nums">{step.done ? "Done" : subStep ? number : `Step ${number}`}</span>
			)}
		</li>
	);
}

/** The field under a step that adds sub-steps to it: Enter adds one and empties for the next; Escape, or leaving it empty, closes it. */
function AddSubStep({ onAdd, onClose }: { onAdd: (text: string) => void; onClose: () => void }) {
	const [added, setAdded] = useState(0);
	const add = (text: string): boolean => {
		const line = collapseSpaces(text);
		if (!line) return false;
		onAdd(line);
		return true;
	};
	return (
		<li className="flex min-h-10 items-center gap-3 border-t border-border/50 py-2 pr-4 pl-[4.5rem] text-sm leading-snug">
			<span className="size-5 shrink-0 rounded-md border border-dashed border-border" aria-hidden />
			<StepInput
				key={added}
				initial=""
				label="New sub-step"
				onKey={(key, text) => {
					if (key === "enter") {
						if (add(text)) setAdded(count => count + 1);
						else onClose();
					} else if (key === "escape") onClose();
					else return false;
					return true;
				}}
				onLeave={text => {
					add(text);
					onClose();
				}}
			/>
		</li>
	);
}
