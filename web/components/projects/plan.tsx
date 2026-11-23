/**
 * A project's plan: its steps and their sub-steps to tick, under **To do**, **Done**, and **All** tabs, with a field to add
 * a step at its end. **Select** turns the boxes into a selection, whose steps **Start session** hands to a new session in the project.
 */
import { IconCheckmark1, IconPlusSmall } from "central-icons";
import { useState } from "react";
import { collapseSpaces } from "../../../src/shared/collapse-spaces";
import { type BoardChange, type ProjectChannel, stepNumbers, type Thread } from "../../../src/shared/board";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { appendToComposer, newDraftKey } from "../../composer-drafts";
import { hashForNewSession } from "../../routing";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { offerUndo } from "../toaster";
import { TodoInput } from "../todo/input";
import { AddLine, Card, EmptyNote, type OnProjectChange, PROJECT_UNDO, RemoveButton } from "./parts";

type PlanTab = "todo" | "done" | "all";

/** Adds step `title` at the end of project `channel`'s plan, or under step `parent`. */
const addStep = (channel: string, title: string, parent: string | null): BoardChange => ({
	op: "thread",
	thread: { id: crypto.randomUUID(), channel, title, task: "open", lease: null, createdAt: Date.now(), ...(parent === null ? {} : { parent }) },
});

/** The steps picked for a new session, or `null` while the plan is not selecting. */
type Selection = ReadonlySet<string> | null;

export function Plan({ channel: project, plan, readOnly, onChange }: { channel: ProjectChannel; plan: readonly Thread[]; readOnly: boolean; onChange: OnProjectChange }) {
	const projectId = project.id;
	const open = plan.filter(step => step.task !== "done");
	const done = plan.filter(step => step.task === "done");
	const [tab, setTab] = useState<PlanTab>(open.length > 0 || done.length === 0 ? "todo" : "all");
	const [selection, setSelection] = useState<Selection>(null);
	const [addingUnder, setAddingUnder] = useState<string | null>(null);
	const filtered = new Set((tab === "todo" ? open : tab === "done" ? done : plan).map(step => step.id));
	// A sub-step shows under its parent even when the tab hides the parent, so it never reads as a top-level step.
	const shown = plan.filter(step => filtered.has(step.id) || plan.some(each => each.parent === step.id && filtered.has(each.id)));
	const numbers = stepNumbers(plan);
	const selecting = selection !== null && !readOnly;
	const tabs: { id: PlanTab; label: string; count: number }[] = [
		{ id: "todo", label: "To do", count: open.length },
		{ id: "done", label: "Done", count: done.length },
		{ id: "all", label: "All", count: plan.length },
	];
	const subStepsOf = (step: Thread): Thread[] => plan.filter(each => each.parent === step.id);
	const remove = (step: Thread): void => {
		const removed = [step, ...subStepsOf(step)];
		onChange({ op: "remove-thread", thread: step.id });
		offerUndo(PROJECT_UNDO, `Removed “${step.title}”`, () => onChange({ op: "all", changes: removed.map(thread => ({ op: "thread", thread })) }));
	};
	// Picking a step picks its sub-steps with it, so a session handed a step gets the whole of it.
	const toggle = (step: Thread): void =>
		setSelection(current => {
			const next = new Set(current);
			const on = !next.has(step.id);
			for (const id of [step.id, ...subStepsOf(step).map(each => each.id)]) on ? next.add(id) : next.delete(id);
			return next;
		});
	const startSession = (): void => {
		const picked = plan.filter(step => selection?.has(step.id));
		if (picked.length === 0) return;
		const lines = picked.map(step => `${step.parent === undefined ? "" : "   "}- ${numbers.get(step.id)}. ${step.title}${step.task === "done" ? " (done)" : ""}`);
		appendToComposer(newDraftKey(null), [`Work on ${picked.length === 1 ? "this step" : "these steps"} of the plan of the project "${project.name}":`, ...lines].join("\n"));
		setSelection(null);
		location.hash = hashForNewSession({ projectId });
	};
	// The field that adds a sub-step sits after the last row shown of its parent's group.
	const lastOfAdding = addingUnder === null ? -1 : shown.findLastIndex(step => step.id === addingUnder || step.parent === addingUnder);
	return (
		<SegmentedTabs value={tab} onValueChange={next => setTab(next as PlanTab)}>
			<Card
				title="Plan"
				action={
					<div className="flex items-center gap-2">
						{!readOnly && plan.length > 0 && (
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
							{plan.length === 0
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
										step={step}
										number={numbers.get(step.id) ?? ""}
										readOnly={readOnly}
										picked={selecting ? (selection?.has(step.id) ?? false) : null}
										onPick={() => toggle(step)}
										onChange={onChange}
										onRemove={() => remove(step)}
										onAddSubStep={step.parent === undefined ? () => setAddingUnder(step.id) : null}
									/>
								);
								if (index !== lastOfAdding || addingUnder === null || selecting) return [row];
								return [row, <AddSubStep key={`add:${addingUnder}`} onAdd={text => onChange(addStep(projectId, text, addingUnder))} onClose={() => setAddingUnder(null)} />];
							})}
						</ul>
					)}
				</SegmentedTabPanel>
				{selecting ? (
					<div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
						<span className="text-xs text-muted-foreground tabular-nums">{selection.size === 0 ? "Pick the steps a new session works on" : `${selection.size} selected`}</span>
						<Button {...activityControl("projects.step.start")} size="compact" leadingIcon={IconPlusSmall} className="ml-auto" disabled={selection.size === 0} onClick={startSession}>
							Start session
						</Button>
					</div>
				) : (
					!readOnly && <AddLine control="projects.step.add" label="Add a step" onAdd={text => onChange(addStep(projectId, text, null))} />
				)}
			</Card>
		</SegmentedTabs>
	);
}

interface PlanRowProps {
	step: Thread;
	number: string;
	readOnly: boolean;
	/** Whether the step is picked while the plan is selecting, else `null`, when its box ticks it. */
	picked: boolean | null;
	onPick: () => void;
	onChange: OnProjectChange;
	onRemove: () => void;
	/** Opens the field that adds a sub-step under it; `null` for a sub-step, which holds none. */
	onAddSubStep: (() => void) | null;
}

/** A step of the plan: a box that ticks it, or picks it while the plan is selecting, its text, which a click edits, and its number in the plan. */
function PlanRow({ step, number, readOnly, picked, onPick, onChange, onRemove, onAddSubStep }: PlanRowProps) {
	const [editing, setEditing] = useState(false);
	const selecting = picked !== null;
	const save = (text: string): void => {
		const line = collapseSpaces(text);
		if (line && line !== step.title) onChange({ op: "retitle", thread: step.id, title: line });
		setEditing(false);
	};
	const subStep = step.parent !== undefined;
	const done = step.task === "done";
	return (
		<li className={cn("group/item flex min-h-10 items-start gap-3 border-b border-border/60 py-2 pr-4 text-sm leading-snug last:border-b-0 hover:bg-accent/50", subStep ? "pl-12" : "pl-4", picked && "bg-accent/50")}>
			{selecting ? (
				<button
					{...activityControl("projects.step.select")}
					type="button"
					role="checkbox"
					aria-checked={picked}
					aria-label={`${picked ? "Unselect" : "Select"} “${step.title}”`}
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
					aria-checked={done}
					aria-label={`${done ? "Untick" : "Tick"} “${step.title}”`}
					disabled={readOnly}
					onClick={() => onChange({ op: "task", thread: step.id, task: done ? "open" : "done", lease: null })}
					className={cn(
						"inline-flex size-5 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
						done ? "border-foreground bg-foreground text-background" : "border-border bg-background enabled:hover:bg-accent",
					)}
				>
					{done && <IconCheckmark1 className="size-3.5" />}
				</button>
			)}
			{editing && !selecting ? (
				<TodoInput
					initial={step.title}
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
					className={cn("min-w-0 flex-1 rounded-sm text-left break-words", done && "text-muted-foreground line-through")}
				>
					{step.title}
				</button>
			)}
			{!readOnly && !editing && !selecting && (
				<>
					{onAddSubStep && (
						<Tooltip content="Add a sub-step">
							<Button
								{...activityControl("projects.step.add-sub")}
								variant="ghost"
								size="icon-xs"
								aria-label={`Add a sub-step under “${step.title}”`}
								className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
								onClick={onAddSubStep}
							>
								<IconPlusSmall />
							</Button>
						</Tooltip>
					)}
					<RemoveButton control="projects.step.remove" label={`Remove the step “${step.title}”${onAddSubStep ? " and its sub-steps" : ""}`} onClick={onRemove} />
				</>
			)}
			<span className="w-14 shrink-0 pt-px text-right text-xs text-muted-foreground tabular-nums">{done ? "Done" : subStep ? number : `Step ${number}`}</span>
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
