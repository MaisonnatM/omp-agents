import { Check, LoaderCircle, Target } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { errorText } from "../../src/json";
import type { GoalChange, GoalSlot, SessionGoal } from "../../src/shared/session-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { useAction } from "../use-action";
import { ERROR_TEXT, FormDialog, FormDialogHeader, isSubmitChord } from "./form-dialog";
import { goalDialogs } from "../session-goal";

const tokens = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const STATUS = { active: "Running", paused: "Paused", "budget-limited": "Budget reached", complete: "Done" } as const;

export function SessionGoalControl({ instanceId, slot, onChange }: { instanceId: string; slot: GoalSlot; onChange: (change: GoalChange) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [dialog, setDialog] = useState<"objective" | "budget" | null>(null);
	const [saving, setSaving] = useState(false);
	const action = useAction(onChange, "Could not change the goal");
	const pending = action.pending || saving;
	const goal = slot.kind === "set" ? slot.goal : null;
	const edit = (focus: "objective" | "budget") => { setOpen(false); setDialog(focus); };
	const requested = goalDialogs.use(instanceId);
	useEffect(() => {
		if (!requested) return;
		goalDialogs.set(instanceId, false);
		if (slot.kind !== "off") { setOpen(false); setDialog("objective"); }
	}, [requested, instanceId, slot.kind]);
	return <>
		{goal ? <Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild><button {...activityControl("header.goal")} type="button" disabled={pending} aria-label={`Goal ${STATUS[goal.status]}: ${goal.objective}`} className="min-w-0 shrink rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<Badge variant="dot" size="compact" color={goal.status === "active" ? "green" : goal.status === "budget-limited" ? "amber" : "gray"} className="max-w-64 hover:bg-accent">
					<span className="flex min-w-0 items-center gap-1">
						{pending ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : goal.status === "complete" ? <Check aria-hidden className="size-3" /> : null}
						<span className="min-w-0 truncate">{goal.status === "active" ? goal.objective : goal.status === "budget-limited" ? "Budget reached" : `${STATUS[goal.status]} · ${goal.objective}`}</span>
						{slot.kind === "set" && slot.continues && goal.status === "active" && goal.tokenBudget !== null && <span className="shrink-0 tabular-nums text-muted-foreground">{tokens.format(goal.tokensUsed)}/{tokens.format(goal.tokenBudget)}</span>}
					</span>
				</Badge>
			</button></PopoverTrigger>
			<PopoverContent align="end" className="w-80 space-y-3" onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }}>
				<PopoverHeader><div className="flex items-center justify-between text-sm"><span>Goal</span><span className="text-xs text-muted-foreground">{STATUS[goal.status]}</span></div></PopoverHeader>
				<p className="break-words text-sm">{goal.objective}</p>
				{goal.tokenBudget !== null && <progress aria-label="Goal token budget used" value={goal.tokensUsed} max={goal.tokenBudget} className="h-1.5 w-full accent-primary" />}
				<p className="text-xs tabular-nums text-muted-foreground">{tokens.format(goal.tokensUsed)}{goal.tokenBudget === null ? " tokens" : ` of ${tokens.format(goal.tokenBudget)} tokens`} · {Math.floor(goal.timeUsedSeconds / 60)} min</p>
				<p className="text-xs text-muted-foreground">{slot.kind === "set" && slot.continues ? "Keeps working on its own while running." : "Advances when you send a prompt."}</p>
				<div className="flex flex-wrap gap-1">
					{(goal.status === "active" || goal.status === "paused") && <Button size="compact" variant="secondary" disabled={pending} onClick={() => action.run({ op: goal.status === "active" ? "pause" : "resume" })}>{goal.status === "active" ? "Pause" : "Resume"}</Button>}
					<Button size="compact" variant="ghost" disabled={pending} onClick={() => edit(goal.status === "budget-limited" ? "budget" : "objective")}>{goal.status === "budget-limited" ? "Raise budget…" : goal.status === "complete" ? "Set new goal…" : "Edit…"}</Button>
					<Button size="compact" variant="ghost" disabled={pending} onClick={() => { setOpen(false); action.run({ op: "clear" }); }}>Clear</Button>
				</div>
			</PopoverContent>
		</Popover> : <Tooltip content={slot.kind === "off" ? slot.reason : "Set goal"}>
			<Button {...activityControl("header.goal")} variant="ghost" size="icon-compact" disabled={slot.kind === "off" || pending} aria-label="Set goal" onClick={() => edit("objective")}><Target /></Button>
		</Tooltip>}
		{dialog && <GoalDialog goal={goal?.status === "complete" ? null : goal} focus={dialog} continues={slot.kind !== "off" && slot.continues} onClose={() => setDialog(null)} onSave={async change => { setSaving(true); try { await onChange(change); setDialog(null); } finally { setSaving(false); } }} />}
	</>;
}

function GoalDialog({ goal, focus, continues, onClose, onSave }: { goal: SessionGoal | null; focus: "objective" | "budget"; continues: boolean; onClose: () => void; onSave: (change: GoalChange) => Promise<void> }) {
	const id = useId();
	const [objective, setObjective] = useState(goal?.objective ?? "");
	const [budget, setBudget] = useState(goal?.tokenBudget === null || !goal ? "none" : [100000, 500000, 1000000].includes(goal.tokenBudget) ? String(goal.tokenBudget) : "custom");
	const [custom, setCustom] = useState(String(goal?.tokenBudget ?? ""));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitting = useRef(false);
	const submit = async () => {
		if (submitting.current) return;
		const tokenBudget = budget === "none" ? null : Number(budget === "custom" ? custom : budget);
		if (!objective.trim() || (tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0))) {
			setError(!objective.trim() ? "Enter the goal's objective." : "Enter a positive whole token count.");
			return;
		}
		submitting.current = true;
		setBusy(true);
		setError(null);
		try { await onSave({ op: "set", objective: objective.trim(), tokenBudget }); }
		catch (err) { setError(errorText(err)); }
		finally { submitting.current = false; setBusy(false); }
	};
	return <FormDialog busy={busy} onClose={onClose} className="top-24 w-[min(30rem,calc(100vw-2rem))]">
		<FormDialogHeader title={goal ? "Edit goal" : "Set goal"} busy={busy} />
		<form className="space-y-4 p-4" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => { if (isSubmitChord(event)) { event.preventDefault(); void submit(); } }}>
			<div className="space-y-2"><label htmlFor={`${id}-objective`} className="block text-xs font-medium">Objective</label><textarea id={`${id}-objective`} autoFocus={focus === "objective"} required value={objective} disabled={busy} onChange={event => setObjective(event.target.value)} rows={4} className="w-full resize-y rounded-md border bg-background p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" /></div>
			<div className="space-y-2"><label htmlFor={`${id}-budget`} className="block text-xs font-medium">Token budget</label><select id={`${id}-budget`} autoFocus={focus === "budget"} value={budget} disabled={busy} onChange={event => setBudget(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"><option value="none">None</option><option value="100000">100k</option><option value="500000">500k</option><option value="1000000">1M</option><option value="custom">Custom</option></select>
			{budget === "custom" && <><label htmlFor={`${id}-custom`} className="block text-xs font-medium">Custom token budget</label><input id={`${id}-custom`} type="number" min={1} step={1} required value={custom} disabled={busy} onChange={event => setCustom(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" /></>}</div>
			<p className="text-xs text-muted-foreground">{continues ? "The goal can keep working on its own." : "Advances when you send a prompt. Automatic continuation requires rpc in goal.continuationModes."}</p>
			{goal && <p className="text-xs text-muted-foreground">Saving replaces the goal and resets its token and time counts.</p>}
			{error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
			<div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={busy}>{goal ? "Save goal" : "Set goal"}</Button></div>
		</form>
	</FormDialog>;
}
