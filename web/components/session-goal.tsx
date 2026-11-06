import { Check, LoaderCircle, Target } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { GoalChange, GoalSlot, SessionGoal } from "../../src/shared/session-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { useAction } from "../use-action";
import { useInlineConfirm } from "../use-inline-confirm";
import { FIELD, TEXT_AREA } from "./form-field";
import { ERROR_TEXT, FormDialog, FormDialogHeader, isSubmitChord } from "./form-dialog";

const tokens = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const STATUS = { active: "Running", paused: "Paused", "budget-limited": "Budget reached", complete: "Done" } as const;
const BUDGETS = [{ value: "none", label: "None" }, { value: "100000", label: "100k" }, { value: "500000", label: "500k" }, { value: "1000000", label: "1M" }, { value: "custom", label: "Custom" }];

export function SessionGoalControl({ instanceId, slot, onChange, onEdit }: {
	instanceId: string;
	slot: GoalSlot;
	onChange: (change: GoalChange) => Promise<void>;
	onEdit: (focus: "objective" | "budget") => void;
}) {
	const [open, setOpen] = useState(false);
	const action = useAction(onChange, "Could not change the goal");
	const clear = useInlineConfirm(`goal:${instanceId}`);
	const firstAction = useRef<HTMLButtonElement>(null);
	const goal = slot.kind === "set" ? slot.goal : null;
	const canPause = goal?.status === "active" || goal?.status === "paused";
	const edit = (focus: "objective" | "budget") => {
		setOpen(false);
		onEdit(focus);
	};
	return goal ? (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button {...activityControl("header.goal")} type="button" disabled={action.pending} aria-label={`Goal ${STATUS[goal.status]}: ${goal.objective}`} className="min-w-0 max-w-64 shrink rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<Badge variant="dot" size="compact" color={goal.status === "active" ? "green" : goal.status === "budget-limited" ? "amber" : "gray"} className="min-w-0 max-w-full hover:bg-accent [&>span:last-child]:min-w-0">
						<span className="flex min-w-0 items-center gap-1">
							{action.pending ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : goal.status === "complete" ? <Check aria-hidden className="size-3" /> : null}
							<span className="min-w-0 truncate">{goal.status === "active" ? goal.objective : goal.status === "budget-limited" ? "Budget reached" : `${STATUS[goal.status]} · ${goal.objective}`}</span>
							{slot.kind === "set" && slot.continues && goal.status === "active" && goal.tokenBudget !== null && <span className="shrink-0 tabular-nums text-muted-foreground">{tokens.format(goal.tokensUsed)}/{tokens.format(goal.tokenBudget)}</span>}
						</span>
					</Badge>
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 space-y-3" onOpenAutoFocus={event => { event.preventDefault(); firstAction.current?.focus(); }}>
				<PopoverHeader>
					<div className="flex items-center justify-between text-sm"><span>Goal</span><span className="text-xs text-muted-foreground">{STATUS[goal.status]}</span></div>
				</PopoverHeader>
				<p className="break-words text-sm">{goal.objective}</p>
				{goal.tokenBudget !== null && (
					<span role="progressbar" aria-label="Goal token budget used" aria-valuemin={0} aria-valuemax={goal.tokenBudget} aria-valuenow={Math.min(goal.tokensUsed, goal.tokenBudget)} aria-valuetext={`${goal.tokensUsed} of ${goal.tokenBudget} tokens`} className="block h-1.5 overflow-hidden rounded-full bg-muted">
						<span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${Math.min(goal.tokensUsed / goal.tokenBudget, 1) * 100}%` }} />
					</span>
				)}
				<p className="text-xs tabular-nums text-muted-foreground">{tokens.format(goal.tokensUsed)}{goal.tokenBudget === null ? " tokens" : ` of ${tokens.format(goal.tokenBudget)} tokens`} · {Math.floor(goal.timeUsedSeconds / 60)} min</p>
				<p className="text-xs text-muted-foreground">{slot.kind === "set" && slot.continues ? "Keeps working on its own while running." : "Advances when you send a prompt."}</p>
				<div className="flex flex-wrap gap-1">
					{canPause && (
						<Button ref={firstAction} size="compact" variant="secondary" disabled={action.pending} onClick={() => action.run({ op: goal.status === "active" ? "pause" : "resume" })}>
							{goal.status === "active" ? "Pause" : "Resume"}
						</Button>
					)}
					<Button ref={canPause ? undefined : firstAction} size="compact" variant="ghost" disabled={action.pending} onClick={() => edit(goal.status === "budget-limited" ? "budget" : "objective")}>
						{goal.status === "budget-limited" ? "Raise budget…" : goal.status === "complete" ? "Set new goal…" : "Edit…"}
					</Button>
					<Button size="compact" variant="destructive-outline" className="ml-auto" disabled={action.pending} {...clear.props("clear", () => { setOpen(false); action.run({ op: "clear" }); })}>
						{clear.isArmed("clear") ? "Clear goal?" : "Clear"}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	) : (
		<Tooltip content={slot.kind === "off" ? slot.reason : "Set goal"}>
			<Button {...activityControl("header.goal")} variant="ghost" size="icon-compact" disabled={slot.kind === "off" || action.pending} aria-label="Set goal" onClick={() => edit("objective")}><Target /></Button>
		</Tooltip>
	);
}

export function GoalDialog({ goal, focus, continues, onClose, onSave }: { goal: SessionGoal | null; focus: "objective" | "budget"; continues: boolean; onClose: () => void; onSave: (change: GoalChange) => Promise<void> }) {
	const id = useId();
	const [objective, setObjective] = useState(goal?.objective ?? "");
	const [budget, setBudget] = useState(goal?.tokenBudget === null || !goal ? "none" : BUDGETS.some(({ value }) => value === String(goal.tokenBudget)) ? String(goal.tokenBudget) : "custom");
	const [custom, setCustom] = useState(String(goal?.tokenBudget ?? ""));
	const save = useAction(onSave, null);
	const busy = save.pending;
	/** The field the form refuses, which a save never sets; a refused save is `save.error`. */
	const [error, setError] = useState<{ field: "objective" | "budget"; message: string } | null>(null);
	const objectiveInput = useRef<HTMLTextAreaElement>(null);
	const budgetInput = useRef<HTMLInputElement>(null);
	const errorMessage = useRef<HTMLParagraphElement>(null);
	useEffect(() => { if (save.error !== null) errorMessage.current?.focus(); }, [save.error]);
	const submit = () => {
		if (busy) return;
		const tokenBudget = budget === "none" ? null : Number(budget === "custom" ? custom : budget);
		const field = !objective.trim() ? "objective" : tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) ? "budget" : null;
		if (field) {
			setError({ field, message: field === "objective" ? "Enter the goal's objective." : "Enter a positive whole token count." });
			save.dismiss();
			(field === "objective" ? objectiveInput.current : budgetInput.current)?.focus();
			return;
		}
		setError(null);
		save.run({ op: "set", objective: objective.trim(), tokenBudget });
	};
	return (
		<FormDialog busy={busy} onClose={onClose} className="top-24 w-[min(30rem,calc(100vw-2rem))]">
			<FormDialogHeader title={goal ? "Edit goal" : "Set goal"} busy={busy} />
			<form noValidate className="space-y-4 p-4" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => { if (isSubmitChord(event)) { event.preventDefault(); void submit(); } }}>
				<div className="space-y-2">
					<label htmlFor={`${id}-objective`} className="block text-xs font-medium">Objective</label>
					<textarea ref={objectiveInput} id={`${id}-objective`} autoFocus={focus === "objective"} required aria-invalid={error?.field === "objective" || undefined} aria-describedby={error?.field === "objective" ? `${id}-error` : undefined} value={objective} disabled={busy} onChange={event => { setObjective(event.target.value); if (error?.field === "objective") setError(null); }} rows={4} className={`${TEXT_AREA} resize-y`} />
				</div>
				<div className="space-y-2">
					<label htmlFor={`${id}-budget`} className="block text-xs font-medium">Token budget</label>
					<Select items={BUDGETS} value={budget} disabled={busy} onValueChange={value => { if (value !== null) setBudget(value); if (error?.field === "budget") setError(null); }}>
						<SelectTrigger id={`${id}-budget`} autoFocus={focus === "budget"} className="w-full"><SelectValue /></SelectTrigger>
						<SelectContent>
							{BUDGETS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
						</SelectContent>
					</Select>
					{budget === "custom" && (
						<>
							<label htmlFor={`${id}-custom`} className="block text-xs font-medium">Custom token budget</label>
							<input ref={budgetInput} id={`${id}-custom`} type="number" min={1} step={1} required aria-invalid={error?.field === "budget" || undefined} aria-describedby={error?.field === "budget" ? `${id}-error` : undefined} value={custom} disabled={busy} onChange={event => { setCustom(event.target.value); if (error?.field === "budget") setError(null); }} className={`${FIELD} w-full`} />
						</>
					)}
				</div>
				<p className="text-xs text-muted-foreground">{continues ? "The goal can keep working on its own." : "Advances when you send a prompt. Turn on automatic continuation in omp's goal settings."}</p>
				{goal && <p className="text-xs text-muted-foreground">Saving replaces the goal and resets its token and time counts.</p>}
				{(error ?? save.error) && <p ref={errorMessage} id={`${id}-error`} role="alert" tabIndex={-1} className={ERROR_TEXT}>{error?.message ?? save.error}</p>}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
					<Button type="submit" loading={busy} disabled={busy}>{goal ? "Save goal" : "Set goal"}</Button>
				</div>
			</form>
		</FormDialog>
	);
}
