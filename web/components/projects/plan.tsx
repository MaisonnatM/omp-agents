/**
 * A project's plan: its steps and their sub-steps to tick, under **To do**, **Done**, and **All** tabs, with a field to add
 * a step at its end. A step's play button, or **Select** and **Start session** for several, hands steps to a new session in the project.
 */
import { IconCheckmark1, IconPlay, IconPlusSmall } from "central-icons";
import { useState } from "react";
import { collapseSpaces } from "../../../src/shared/collapse-spaces";
import { type Project, type ProjectStep, stepNumbers } from "../../../src/shared/projects";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { appendToComposer, newDraftKey } from "../../composer-drafts";
import { hashForNewSession } from "../../routing";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { offerUndo } from "../toaster";
import { TodoInput } from "../todo/input";
import { AddLine, Card, EmptyNote, type OnProjectChange, PROJECT_UNDO, RemoveButton, RowAction } from "./parts";
import { stepsPrompt } from "./steps-prompt";

type PlanTab = "todo" | "done" | "all";

/** The steps picked for a new session, or `null` while the plan is not selecting. */
type Selection = ReadonlySet<string> | null;

export function Plan({ project, readOnly, onChange }: { project: Project; readOnly: boolean; onChange: OnProjectChange }) {
	const projectId = project.id;
	const open = project.steps.filter(step => !step.done);
	const done = project.steps.filter(step => step.done);
	const [tab, setTab] = useState<PlanTab>(open.length > 0 || done.length === 0 ? "todo" : "all");
	const [selection, setSelection] = useState<Selection>(null);
	const [addingUnder, setAddingUnder] = useState<string | null>(null);
	const filtered = new Set((tab === "todo" ? open : tab === "done" ? done : project.steps).map(step => step.id));
	// A sub-step shows under its parent even when the tab hides the parent, so it never reads as a top-level step.
	const shown = project.steps.filter(step => filtered.has(step.id) || project.steps.some(each => each.parentId === step.id && filtered.has(each.id)));
	const numbers = stepNumbers(project.steps);
	const selecting = selection !== null && !readOnly;
	const tabs: { id: PlanTab; label: string; count: number }[] = [
		{ id: "todo", label: "To do", count: open.length },
		{ id: "done", label: "Done", count: done.length },
		{ id: "all", label: "All", count: project.steps.length },
	];
	const subStepsOf = (step: ProjectStep): ProjectStep[] => project.steps.filter(each => each.parentId === step.id);
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
	const withSubSteps = (step: ProjectStep): string[] => [step.id, ...subStepsOf(step).map(each => each.id)];
	// Picking a step picks its sub-steps with it, so a session handed a step gets the whole of it.
	const toggle = (step: ProjectStep): void =>
		setSelection(current => {
			const next = new Set(current);
			const on = !next.has(step.id);
			for (const id of withSubSteps(step)) on ? next.add(id) : next.delete(id);
			return next;
		});
	const startSession = (stepIds: ReadonlySet<string>): void => {
		const prompt = stepsPrompt(project, stepIds);
		if (prompt === null) return;
		appendToComposer(newDraftKey(null), prompt);
		setSelection(null);
		location.hash = hashForNewSession({ projectId });
	};
	// The field that adds a sub-step sits after the last row shown of its parent's group.
	const lastOfAdding = addingUnder === null ? -1 : shown.findLastIndex(step => step.id === addingUnder || step.parentId === addingUnder);
	return (
		<SegmentedTabs value={tab} onValueChange={next => setTab(next as PlanTab)}>
			<Card
				title="Plan"
				action={
					<div className="flex items-center gap-2">
						{!readOnly && project.steps.length > 0 && (
							<Button {...activityControl("projects.step.select")} variant="ghost" size="xs" aria-pressed={selecting} onClick={() => setSelection(selecting ? null : new Set())}>
								{selecting ? "Cancel" : "Select"}
							</Button>
						)}
						<SegmentedTabsList aria-label="Steps shown">
							{tabs.map(({ id, label, count }) => (
								<SegmentedTab key={id} value={id}>
									{label}
									<span className="tabular-nums text-muted-foreground">{count}</span>
								</SegmentedTab>
							))}
						</SegmentedTabsList>
					</div>
				}
			>
				<SegmentedTabPanel value={tab}>
					{shown.length === 0 ? (
						<EmptyNote>
							{project.steps.length === 0
								? "Break the goal into steps. Every session in the project reads the plan at its start and ticks what it finishes."
								: tab === "todo"
									? "Nothing left to do."
									: "No step done yet."}
						</EmptyNote>
					) : (
						<ul className="flex flex-col">
							{shown.flatMap((step, index) => {
								const row = (
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
										onAddSubStep={step.parentId === undefined ? () => setAddingUnder(step.id) : null}
										onStart={() => startSession(new Set(withSubSteps(step)))}
									/>
								);
								if (index !== lastOfAdding || addingUnder === null || selecting) return [row];
								return [row, <AddSubStep key={`add:${addingUnder}`} onAdd={text => onChange({ op: "add-step", projectId, stepId: crypto.randomUUID(), text, parentId: addingUnder })} onClose={() => setAddingUnder(null)} />];
							})}
						</ul>
					)}
				</SegmentedTabPanel>
				{selecting ? (
					<div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
						<span className="text-xs text-muted-foreground tabular-nums">{selection.size === 0 ? "Pick the steps a new session works on" : `${selection.size} selected`}</span>
						<Button
							{...activityControl("projects.step.start")}
							size="compact"
							leadingIcon={IconPlay}
							className="ml-auto"
							disabled={selection.size === 0}
							onClick={() => startSession(selection)}
						>
							Start session
						</Button>
					</div>
				) : (
					!readOnly && <AddLine control="projects.step.add" label="Add a step" onAdd={text => onChange({ op: "add-step", projectId, stepId: crypto.randomUUID(), text })} />
				)}
			</Card>
		</SegmentedTabs>
	);
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
}

/** A step of the plan: a box that ticks it, or picks it while the plan is selecting, its text, which a click edits, and its number in the plan. */
function PlanRow({ projectId, step, number, readOnly, picked, onPick, onChange, onRemove, onAddSubStep, onStart }: PlanRowProps) {
	const [editing, setEditing] = useState(false);
	const selecting = picked !== null;
	const save = (text: string): void => {
		const line = collapseSpaces(text);
		if (line && line !== step.text) onChange({ op: "edit-step", projectId, stepId: step.id, text: line });
		setEditing(false);
	};
	const subStep = step.parentId !== undefined;
	return (
		<li className={cn("group/item flex min-h-10 items-start gap-3 border-b border-border/60 py-2 pr-4 text-sm leading-snug last:border-b-0 hover:bg-accent/50", subStep ? "pl-12" : "pl-4", picked && "bg-accent/50")}>
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
				<TodoInput
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
					className={cn("min-w-0 flex-1 rounded-sm text-left break-words", step.done && "text-muted-foreground line-through")}
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
			<span className="w-14 shrink-0 pt-px text-right text-xs text-muted-foreground tabular-nums">{step.done ? "Done" : subStep ? number : `Step ${number}`}</span>
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
		<li className="flex min-h-10 items-center gap-3 border-b border-border/60 py-2 pr-4 pl-12 text-sm leading-snug last:border-b-0">
			<span className="size-5 shrink-0 rounded-md border border-dashed border-border" aria-hidden />
			<TodoInput
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
