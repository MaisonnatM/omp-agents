import { memo, type ReactNode, useId, useMemo, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { addUsage, type Clipped, NO_USAGE, type TokenUsage, type Turn, type TurnStep, totalTokens } from "../../src/shared/trajectory";
import { cn } from "@/lib/utils";
import { formatBytes, skillLabel } from "../labels";
import { useShowTrajectory, useTurns } from "../pane-store";
import { FoldButton } from "./fold";

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const EXACT = new Intl.NumberFormat("en-US");

const cost = (dollars: number): string => `$${dollars < 0.01 && dollars > 0 ? dollars.toFixed(4) : dollars.toFixed(2)}`;

function duration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Each kind of token a usage spent, then its cost, as one line. */
const usageParts = (usage: TokenUsage): string[] => [
	`${EXACT.format(usage.input)} in`,
	`${EXACT.format(usage.output)} out`,
	`${EXACT.format(usage.cacheRead)} cache read`,
	`${EXACT.format(usage.cacheWrite)} cache write`,
	cost(usage.cost),
];

const firstLine = (text: string): string => text.trimStart().split("\n", 1)[0] ?? "";

/** A view's turns, one foldable row each: what reached the model, what it did, and what it cost. */
export function Trajectory({ view }: { view: View }) {
	useShowTrajectory(view);
	const turns = useTurns(view);
	const total = useMemo(() => (turns ?? []).reduce((sum, turn) => addUsage(sum, turn.usage), NO_USAGE), [turns]);
	if (turns === null) return <p className="m-auto text-sm text-muted-foreground">Reading turns…</p>;
	if (turns.length === 0) return <p className="m-auto text-sm text-muted-foreground">No turns yet.</p>;
	return (
		<div className="min-h-0 flex-1 overflow-y-auto" data-trajectory>
			<div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3">
				<p className="text-xs text-muted-foreground tabular-nums" data-trajectory-total>
					{turns.length} {turns.length === 1 ? "turn" : "turns"} · {COMPACT.format(totalTokens(total))} tokens · {usageParts(total).join(" · ")}
				</p>
				<ol className="space-y-1.5">
					{turns.map(turn => (
						<TurnRow key={turn.id} turn={turn} />
					))}
				</ol>
			</div>
		</div>
	);
}

const TurnRow = memo(function TurnRow({ turn }: { turn: Turn }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const prompt = turn.steps.find(step => step.kind === "prompt");
	const title = prompt ? firstLine(prompt.body.text) : "Before the first prompt";
	return (
		<li className="rounded-md border border-border" data-turn={turn.id}>
			<div className="flex items-center gap-3 px-3 py-2 text-sm">
				<FoldButton open={open} onToggle={() => setOpen(!open)} controls={id} className="min-w-0 flex-1">
					<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{turn.index}</span>
					{prompt?.skill && <span className="shrink-0 rounded bg-muted px-1.5 text-xs">{skillLabel(prompt.skill)}</span>}
					<span className="truncate">{title}</span>
				</FoldButton>
				<span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={usageParts(turn.usage).join(" · ")}>
					{turn.requests} {turn.requests === 1 ? "request" : "requests"} · {turn.toolCalls} {turn.toolCalls === 1 ? "tool" : "tools"} · {COMPACT.format(totalTokens(turn.usage))} tokens ·{" "}
					{cost(turn.usage.cost)}
				</span>
			</div>
			{open && (
				<div id={id} className="space-y-1 border-t border-border px-3 py-2">
					<p className="pb-1 text-xs text-muted-foreground tabular-nums" data-turn-usage>
						{usageParts(turn.usage).join(" · ")}
					</p>
					<ol className="space-y-1">
						{turn.steps.map((step, index) => (
							<li key={index}>
								<Step step={step} />
							</li>
						))}
					</ol>
				</div>
			)}
		</li>
	);
});

/** One line, or a foldable body under its first line. */
function Line({ label, children, body, tone }: { label: string; children?: ReactNode; body?: Clipped; tone?: string }) {
	const head = (
		<>
			<span className="shrink-0 font-medium">{label}</span>
			<span className="min-w-0 truncate text-muted-foreground">{children}</span>
		</>
	);
	if (!body) return <p className={cn("flex items-baseline gap-2 text-xs tabular-nums", tone)}>{head}</p>;
	return (
		<details className={cn("text-xs", tone)}>
			<summary className="flex cursor-pointer items-baseline gap-2 tabular-nums">{head}</summary>
			<pre className="mt-1 mb-2 max-h-96 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap text-foreground">
				{body.text}
				{body.cut > 0 && <span className="text-muted-foreground">{`\n… ${EXACT.format(body.cut)} more characters`}</span>}
			</pre>
		</details>
	);
}

function Step({ step }: { step: TurnStep }) {
	switch (step.kind) {
		case "prompt":
			return (
				<Line label={step.skill ? `Prompt · /skill:${step.skill}` : "Prompt"} body={step.body}>
					{firstLine(step.body.text)}
				</Line>
			);
		case "injection":
			return (
				<Line label={`Injected · ${step.source}`} body={step.body} tone="text-amber-700 dark:text-amber-400">
					{[step.attribution && `by ${step.attribution}`, firstLine(step.body.text)].filter(Boolean).join(" · ")}
				</Line>
			);
		case "request":
			return (
				<Line label="Request" tone="text-sky-700 dark:text-sky-400">
					{[step.model, ...usageParts(step.usage), step.durationMs !== null && duration(step.durationMs), step.stopReason].filter(Boolean).join(" · ")}
				</Line>
			);
		case "thinking":
			return (
				<Line label="Thinking" body={step.body}>
					{firstLine(step.body.text)}
				</Line>
			);
		case "reply":
			return (
				<Line label="Reply" body={step.body}>
					{firstLine(step.body.text)}
				</Line>
			);
		case "tool":
			return (
				<Line label={`Tool · ${step.name}`} body={step.args} tone={step.status === "error" ? "text-red-700 dark:text-red-400" : undefined}>
					{[
						step.status === "running" ? "running" : step.status === "error" ? "error" : null,
						step.resultBytes !== null && `${formatBytes(step.resultBytes)} result`,
						step.resultImages > 0 && `${step.resultImages} ${step.resultImages === 1 ? "image" : "images"}`,
						step.durationMs !== null && duration(step.durationMs),
					]
						.filter(Boolean)
						.join(" · ")}
				</Line>
			);
		case "side-call":
			return (
				<Line label={`Side call · ${step.purpose}`} tone="text-violet-700 dark:text-violet-400">
					{[step.model, ...usageParts(step.usage)].join(" · ")}
				</Line>
			);
		case "model":
			return <Line label="Model change">{[step.model, step.role && `as ${step.role}`].filter(Boolean).join(" · ")}</Line>;
		case "thinking-level":
			return <Line label="Thinking level">{step.level}</Line>;
		case "compaction":
			return <Line label="Compaction">{step.tokensBefore === null ? "" : `${EXACT.format(step.tokensBefore)} tokens before`}</Line>;
		default: {
			const never: never = step;
			return never;
		}
	}
}
