/** A project's plan: its steps to tick, under **To do**, **Done**, and **All** tabs, with a field to add one at its end. */
import { IconCheckmark1 } from "central-icons";
import { useState } from "react";
import { collapseSpaces } from "../../../src/shared/collapse-spaces";
import type { Project } from "../../../src/shared/projects";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { offerUndo } from "../toaster";
import { TodoInput } from "../todo/input";
import { AddLine, Card, EmptyNote, type OnProjectChange, PROJECT_UNDO, RemoveButton } from "./parts";

type PlanTab = "todo" | "done" | "all";

type Step = Project["steps"][number];

export function Plan({ project, readOnly, onChange }: { project: Project; readOnly: boolean; onChange: OnProjectChange }) {
	const projectId = project.id;
	const open = project.steps.filter(step => !step.done);
	const done = project.steps.filter(step => step.done);
	const [tab, setTab] = useState<PlanTab>(open.length > 0 || done.length === 0 ? "todo" : "all");
	const shown = tab === "todo" ? open : tab === "done" ? done : project.steps;
	const tabs: { id: PlanTab; label: string; count: number }[] = [
		{ id: "todo", label: "To do", count: open.length },
		{ id: "done", label: "Done", count: done.length },
		{ id: "all", label: "All", count: project.steps.length },
	];
	const remove = (step: Step): void => {
		onChange({ op: "remove-step", projectId, stepId: step.id });
		offerUndo(PROJECT_UNDO, `Removed “${step.text}”`, () => {
			onChange({ op: "add-step", projectId, stepId: step.id, text: step.text });
			if (step.done) onChange({ op: "set-step", projectId, stepId: step.id, done: true });
		});
	};
	return (
		<SegmentedTabs value={tab} onValueChange={next => setTab(next as PlanTab)}>
			<Card
				title="Plan"
				action={
					<SegmentedTabsList aria-label="Steps shown">
						{tabs.map(({ id, label, count }) => (
							<SegmentedTab key={id} value={id}>
								{label}
								<span className="tabular-nums text-muted-foreground">{count}</span>
							</SegmentedTab>
						))}
					</SegmentedTabsList>
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
							{shown.map(step => (
								<PlanRow key={step.id} projectId={projectId} step={step} position={project.steps.indexOf(step) + 1} readOnly={readOnly} onChange={onChange} onRemove={() => remove(step)} />
							))}
						</ul>
					)}
				</SegmentedTabPanel>
				{!readOnly && <AddLine control="projects.step.add" label="Add a step" onAdd={text => onChange({ op: "add-step", projectId, stepId: crypto.randomUUID(), text })} />}
			</Card>
		</SegmentedTabs>
	);
}

/** A step of the plan: a box that ticks it, its text, which a click edits, and its place in the plan. */
function PlanRow({ projectId, step, position, readOnly, onChange, onRemove }: { projectId: string; step: Step; position: number; readOnly: boolean; onChange: OnProjectChange; onRemove: () => void }) {
	const [editing, setEditing] = useState(false);
	const save = (text: string): void => {
		const line = collapseSpaces(text);
		if (line && line !== step.text) onChange({ op: "edit-step", projectId, stepId: step.id, text: line });
		setEditing(false);
	};
	return (
		<li className="group/item flex min-h-9 items-start gap-3 border-b border-border/60 px-4 py-2 text-sm leading-snug last:border-b-0 hover:bg-accent/50">
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
			{editing ? (
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
					{...activityControl("projects.step.edit")}
					type="button"
					disabled={readOnly}
					onClick={() => setEditing(true)}
					className={cn("min-w-0 flex-1 rounded-sm text-left break-words", step.done && "text-muted-foreground line-through")}
				>
					{step.text}
				</button>
			)}
			{!readOnly && !editing && <RemoveButton control="projects.step.remove" label={`Remove the step “${step.text}”`} onClick={onRemove} />}
			<span className="w-14 shrink-0 pt-px text-right text-xs text-muted-foreground tabular-nums">{step.done ? "Done" : `Step ${position}`}</span>
		</li>
	);
}
