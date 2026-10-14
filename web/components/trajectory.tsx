import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { View } from "../../src/shared/sessions";
import { addUsage, NO_USAGE, type Turn, type TurnStep } from "../../src/shared/trajectory";
import { cn } from "@/lib/utils";
import { formatBytes, skillLabel } from "../labels";
import { useShowTrajectory, useTurns } from "../pane-store";

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const cost = (dollars: number): string => `$${dollars < 0.01 && dollars > 0 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
const firstLine = (text: string): string => text.trimStart().split("\n", 1)[0] ?? "";
const seconds = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`);

const titleOf = (turn: Turn): { title: string; skill: string | null } => {
	const prompt = turn.steps.find(step => step.kind === "prompt");
	return prompt ? { title: firstLine(prompt.body.text), skill: prompt.skill } : { title: "Before the first prompt", skill: null };
};
function Chevron({ open }: { open: boolean }) {
	return <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />;
}

function SkillChip({ skill }: { skill: string | null }) {
	return skill ? <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px] font-medium">{skillLabel(skill)}</span> : null;
}

const TOKEN_COLUMNS = [
	["input", "In", "bg-sky-500"],
	["output", "Out", "bg-emerald-500"],
	["cacheRead", "Cache read", "bg-zinc-400 dark:bg-zinc-500"],
	["cacheWrite", "Cache write", "bg-amber-500"],
] as const;

const GRID = "grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_4rem_4rem_4rem_4rem] items-center gap-x-3";

/** A view's turns as a ledger: one row each with its requests, tool calls, tokens, and cost, which opens on its steps. */
export function Trajectory({ view }: { view: View }) {
	useShowTrajectory(view);
	const turns = useTurns(view);
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const toggle = (id: string): void => setOpen(was => (was.has(id) ? new Set([...was].filter(key => key !== id)) : new Set([...was, id])));
	if (turns === null) return <p className="m-auto text-sm text-muted-foreground">Reading turns…</p>;
	if (turns.length === 0) return <p className="m-auto text-sm text-muted-foreground">No turns yet.</p>;
	const total = turns.reduce((sum, turn) => addUsage(sum, turn.usage), NO_USAGE);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto" data-trajectory>
		<div className="mx-auto w-full max-w-4xl px-3 py-3 text-xs tabular-nums">
			<div className={cn(GRID, "border-b border-border px-2 pb-1.5 text-[11px] font-medium text-muted-foreground")}>
				<span>#</span>
				<span>Prompt</span>
				<span className="text-right">Req</span>
				<span className="text-right">Tools</span>
				{TOKEN_COLUMNS.map(([key, label]) => (
					<span key={key} className="text-right">{label}</span>
				))}
				<span className="text-right">Cost</span>
			</div>
			{turns.map(turn => {
				const { title, skill } = titleOf(turn);
				const isOpen = open.has(turn.id);
				return (
					<div key={turn.id} className="border-b border-border/60" data-turn={turn.id}>
						<button type="button" aria-expanded={isOpen} onClick={() => toggle(turn.id)} className={cn(GRID, "w-full px-2 py-2 text-left hover:bg-muted/60")}>
							<span className="flex items-center gap-0.5 text-muted-foreground"><Chevron open={isOpen} />{turn.index}</span>
							<span className="flex min-w-0 items-center gap-1.5">
								<SkillChip skill={skill} />
								<span className="truncate text-[13px]">{title}</span>
							</span>
							<span className="text-right">{turn.requests}</span>
							<span className="text-right">{turn.toolCalls}</span>
							{TOKEN_COLUMNS.map(([key]) => (
								<span key={key} className="text-right text-muted-foreground">{COMPACT.format(turn.usage[key])}</span>
							))}
							<span className="relative text-right font-medium">
								{cost(turn.usage.cost)}
								<span className="absolute right-0 -bottom-1 h-0.5 rounded-full bg-foreground/70" style={{ width: `${(turn.usage.cost / Math.max(total.cost, 1e-9)) * 100}%` }} />
							</span>
						</button>
						{isOpen && (
							<div className="space-y-px pb-2">
								{turn.steps.map((step, index) => <StepRow key={index} step={step} />)}
							</div>
						)}
					</div>
				);
			})}
			<div className={cn(GRID, "px-2 pt-2 font-medium")} data-trajectory-total>
				<span />
				<span>{turns.length} turns</span>
				<span className="text-right">{turns.reduce((sum, turn) => sum + turn.requests, 0)}</span>
				<span className="text-right">{turns.reduce((sum, turn) => sum + turn.toolCalls, 0)}</span>
				{TOKEN_COLUMNS.map(([key]) => (
					<span key={key} className="text-right">{COMPACT.format(total[key])}</span>
				))}
				<span className="text-right">{cost(total.cost)}</span>
			</div>
		</div>
		</div>
	);
}

function StepRow({ step }: { step: TurnStep }) {
	const usage = step.kind === "request" || step.kind === "side-call" ? step.usage : null;
	const body = step.kind === "tool" ? step.args : "body" in step ? step.body : null;
	const [label, detail, tone] = stepText(step);
	const [open, setOpen] = useState(false);
	const line = (
		<>
			<span />
			<span className="flex min-w-0 items-baseline gap-2 pl-3">
				<span className={cn("w-20 shrink-0 truncate font-medium", tone)}>{label}</span>
				<span className="truncate">{detail}</span>
			</span>
			<span />
			<span />
			{TOKEN_COLUMNS.map(([key]) => (
				<span key={key} className="text-right">{usage ? COMPACT.format(usage[key]) : ""}</span>
			))}
			<span className="text-right">{usage ? cost(usage.cost) : ""}</span>
		</>
	);
	const rowClass = cn(GRID, "w-full px-2 py-0.5 text-left text-[11px]", step.kind === "request" ? "text-foreground" : "text-muted-foreground");
	if (!body) return <div className={rowClass}>{line}</div>;
	return (
		<>
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(rowClass, "hover:bg-muted/60")}>
				{line}
			</button>
			{open && (
				<pre className="mx-2 my-1 ml-11 max-h-96 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
					{body.text}
					{body.cut > 0 && <span className="text-muted-foreground">{`\n… ${body.cut.toLocaleString("en-US")} more characters`}</span>}
				</pre>
			)}
		</>
	);
}

function stepText(step: TurnStep): [string, string, string?] {
	switch (step.kind) {
		case "prompt": return ["Prompt", firstLine(step.body.text)];
		case "injection": return ["Injected", `${step.source} · ${firstLine(step.body.text)}`, "text-amber-600 dark:text-amber-400"];
		case "request": return ["Request", [step.model, step.durationMs !== null && seconds(step.durationMs), step.stopReason].filter(Boolean).join(" · "), "text-sky-600 dark:text-sky-400"];
		case "thinking": return ["Thinking", firstLine(step.body.text)];
		case "reply": return ["Reply", firstLine(step.body.text)];
		case "tool": return [step.name, [step.resultBytes !== null && formatBytes(step.resultBytes), step.durationMs !== null && seconds(step.durationMs), step.status === "error" && "error"].filter(Boolean).join(" · "), step.status === "error" ? "text-red-600" : "text-foreground"];
		case "side-call": return ["Side call", `${step.purpose} · ${step.model}`, "text-violet-600 dark:text-violet-400"];
		case "model": return ["Model", step.model];
		case "thinking-level": return ["Thinking lvl", step.level];
		case "compaction": return ["Compaction", step.tokensBefore === null ? "" : `${COMPACT.format(step.tokensBefore)} tokens before`];
	}
}
