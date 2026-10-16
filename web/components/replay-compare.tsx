import { useMemo } from "react";
import type { ReplayComparison, ReplayFacts, ToolPair } from "../../src/shared/replay";
import { compareTurns } from "../../src/shared/replay";
import type { View } from "../../src/shared/sessions";
import type { Turn } from "../../src/shared/trajectory";
import { Button } from "@/components/ui/button";
import { useShowTrajectory, useTurns } from "../pane-store";
import { useRead } from "../reads";
import { useDashboardActions } from "./dashboard-context";
import { FormDialog, FormDialogHeader } from "./form-dialog";

const dollars = (value: number) => `$${value.toFixed(5)}`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
function outcome(turn: Turn | null): string {
	const request = turn?.steps.findLast(step => step.kind === "request");
	if (!request) return "no model request recorded";
	const partial = request.stopReason === "toolUse" || turn?.steps.some(step => step.kind === "tool" && step.status === "running");
	return `${request.stopReason}${partial ? " (partial turn)" : ""}`;
}

export function ReplayCompareDialog({ view, facts, onClose }: { view: View; facts: ReplayFacts; onClose: () => void }) {
	useShowTrajectory(view);
	const turns = useTurns(view);
	const version = useMemo(() => ({ turns, facts }), [turns, facts]);
	const read = useRead<ReplayComparison>(`/api/replay/compare?${new URLSearchParams({ view: JSON.stringify(view) })}`, version);
	const { open } = useDashboardActions();
	const data = read.data;
	const current = data?.facts ?? facts;
	const marker = current.marker;
	const check = current.request;
	const comparison = data?.replay ? compareTurns(data.original, data.replay, marker.roots) : null;
	const firstDifference = comparison?.tools.findIndex(pair => !pair.same) ?? -1;
	return (
		<FormDialog busy={false} onClose={onClose} className="top-4 w-[min(80rem,calc(100vw-2rem))]">
			<FormDialogHeader title="Compare replay" busy={false} />
			<div className="space-y-5 p-4 text-sm">
				<div className="space-y-2">
					<Button size="compact" variant="ghost" onClick={() => open({ kind: "past", sessionId: marker.source.sessionId }, "split")}>Open original session</Button>
					<p className="break-all text-xs text-muted-foreground">Original turn {marker.source.turnId} · Replay model {marker.model.provider}/{marker.model.id} · {marker.thinking ?? "unrecorded thinking"} · detached base {marker.base.sha.slice(0, 12)} ({marker.base.how === "reflog" ? "historical HEAD from reflog" : "current HEAD fallback"})</p>
					<p className="text-xs text-muted-foreground">Original request model: {marker.original?.model ?? data?.original.steps.find(step => step.kind === "request")?.model ?? "unrecorded"}.</p>
					<p className="text-xs text-muted-foreground">Committed files only; historical dirty files and outside state were not restored. Shell commands ran for real. Eval/task, direct LSP, MCP and unknown executables are blocked, not OS-sandboxed. {marker.promptEdited && "Prompt edited. "}{marker.repaired && "Interrupted tool calls repaired by omp. "}</p>
				</div>
				<section aria-label="First request check" className="space-y-2 rounded-md border p-3">
					<h2 className="font-medium">First request: {check?.status === "match" ? "normalized match" : check?.status === "mismatch" ? "mismatch" : check?.status === "unknown" ? "unknown" : "no main request recorded yet"}</h2>
					{check?.status === "unknown" ? <><p>{check.reason}</p>{check.rawEqual !== null && <p>Raw SHA-256: {check.rawEqual ? "equal" : "different"}. No normalized equality claim.</p>}{check.originalHash && <p className="break-all text-xs">Original: {check.originalHash}<br />Replay: {check.replayHash ?? "unavailable"}</p>}</> : check && <>
						<p>Raw SHA-256: {check.rawEqual ? "equal" : "different"}. Normalized SHA-256: {check.status === "match" ? "equal" : "different"}.</p>
						<p className="break-all text-xs">Original: {check.originalHash}<br />Replay: {check.replayHash}<br />Normalized original: {check.normalizedOriginal}<br />Normalized replay: {check.normalizedReplay}</p>
						{check.differences.length > 0 && <p>Changed request fields: {check.differences.join(", ")}. Inspect the complete bodies below before interpreting output differences.</p>}
					</>}
					<p className="text-xs text-muted-foreground">Only root-path prefixes, per-session ids (client_metadata, prompt_cache_key) and deliberately selected model metadata are normalized. Dates, tool catalog, AGENTS/context, history, prompt and reasoning settings remain significant. This compares the logged before-provider hook body, not final wire bytes or deterministic execution.</p>
				</section>
				{read.error && <p role="alert">{read.error}</p>}
				{!data && !read.error && <p role="status">Reading comparison…</p>}
				{data && <>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<section><h2 className="font-medium">Original</h2><p>Outcome: {outcome(data.original)}</p><p>{data.original.usage.input.toLocaleString()} input · {data.original.usage.output.toLocaleString()} output · {data.original.usage.cacheRead.toLocaleString()} cache read · {data.original.usage.cacheWrite.toLocaleString()} cache write · {dollars(data.original.usage.cost)}</p></section>
						<section><h2 className="font-medium">Replay</h2><p>Outcome: {outcome(data.replay)}</p><p>{data.replay ? `${data.replay.usage.input.toLocaleString()} input · ${data.replay.usage.output.toLocaleString()} output · ${data.replay.usage.cacheRead.toLocaleString()} cache read · ${data.replay.usage.cacheWrite.toLocaleString()} cache write · ${dollars(data.replay.usage.cost)}` : "Waiting for the replay prompt."}</p></section>
					</div>
					{comparison && <>
						<p className="tabular-nums">Replay − original: {signed(comparison.tokens.replay - comparison.tokens.original)} total tokens; {comparison.cost.replay >= comparison.cost.original ? "+" : "−"}{dollars(Math.abs(comparison.cost.replay - comparison.cost.original))}. Logged cost, including recorded side calls; unavailable prices may be zero.</p>
						<section className="space-y-3" aria-label="Tool sequence comparison">
							<h2 className="font-medium">Tool calls and arguments {firstDifference < 0 ? "match so far" : `first differ at aligned call ${firstDifference + 1}`}</h2>
							{comparison.tools.length === 0 && <p>No tools in either turn.</p>}
							{comparison.tools.map((pair, index) => <ToolComparison key={index} pair={pair} index={index} />)}
						</section>
						<section className="space-y-2" aria-label="Final text comparison">
							<h2 className="font-medium">Last request's text {comparison.reply.same ? "matches after root normalization" : "differs or is not yet available"}</h2>
							<p className="text-xs text-muted-foreground">Partial until the turn finishes; aborted or failed requests are labelled by their outcome above.</p>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><pre className="min-w-0 whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs" aria-label="Original final text">{comparison.reply.original?.text ?? "No reply text."}</pre><pre className="min-w-0 whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs" aria-label="Replay final text">{comparison.reply.replay?.text ?? "No reply text yet."}</pre></div>
						</section>
					</>}
					<details><summary className="cursor-pointer py-2 font-medium">Complete first request bodies</summary><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><pre aria-label="Original request body" className="min-w-0 whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{data.requestBodies.original === null ? "Original request unavailable." : JSON.stringify(data.requestBodies.original, null, 2)}</pre><pre aria-label="Replay request body" className="min-w-0 whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{data.requestBodies.replay === null ? "Replay request unavailable or not yet verified." : JSON.stringify(data.requestBodies.replay, null, 2)}</pre></div></details>
				</>}
			</div>
		</FormDialog>
	);
}

function ToolComparison({ pair, index }: { pair: ToolPair; index: number }) {
	return <details className="rounded-md border p-3"><summary className="cursor-pointer">{index + 1}. {pair.original?.name ?? pair.replay?.name} — {pair.same ? "same arguments" : pair.original === null ? "replay only" : pair.replay === null ? "original only" : "different arguments"}{pair.replay?.blocked && " · blocked"}</summary><div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">{([pair.original, pair.replay] as const).map((tool, side) => <section key={side} className="min-w-0"><h3 className="font-medium">{side === 0 ? "Original" : "Replay"}</h3>{tool ? <><p>{tool.status}{tool.blocked ? " · guard blocked" : ""} · {tool.resultBytes ?? "pending"} result bytes · {tool.resultImages} images · {tool.durationMs === null ? "duration unrecorded" : `${tool.durationMs} ms`}</p><pre className="whitespace-pre-wrap break-words bg-muted p-2 text-xs">{tool.args.text}</pre>{tool.result && <pre className="mt-2 whitespace-pre-wrap break-words bg-muted p-2 text-xs">{tool.result.text}</pre>}</> : <p>No corresponding call.</p>}</section>)}</div></details>;
}
