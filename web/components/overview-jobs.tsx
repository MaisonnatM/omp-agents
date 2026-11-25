/**
 * The Overview tab's Jobs section: the session's background jobs, each with its command, how long it ran, its last output line, and the
 * progress that output reports; a click unfolds its last lines, and a failed job starts unfolded.
 */
import { IconConsole } from "central-icons";
import { useEffect, useRef, useState } from "react";
import { type BackgroundJob, jobProgress, type JobProgress, jobTimeLeft } from "../../src/shared/jobs";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { useStoredState } from "../stored-state";
import { useSecond } from "../use-minute";
import { OverviewSection } from "./overview-section";

/** Whether the section is folded shut, kept for every view; it starts open. */
const CLOSED_KEY = "omp-agents.overview-jobs-closed";

const failed = (job: BackgroundJob) => job.state === "failed" || job.state === "cancelled";

/** `41m 12s`, or `1h 07m` from an hour. */
function jobDuration(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** `~6 min left`, `~1h 06m left`, or `<1 min left`. */
function timeLeft(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return "<1 min left";
	return minutes < 60 ? `~${minutes} min left` : `~${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m left`;
}

/** `jobs`, the session's, which the Overview tab shows this section for only while it has any. */
export function JobsSection({ jobs }: { jobs: readonly BackgroundJob[] }) {
	const [closed, setClosed] = useStoredState(CLOSED_KEY, raw => raw === "true");
	const running = jobs.filter(job => job.state === "running").length;
	const failures = jobs.filter(failed).length;
	return (
		<OverviewSection
			title="Jobs"
			count={jobs.length}
			detail={
				(running > 0 || failures > 0) && (
					<span className="shrink-0 font-normal text-muted-foreground">
						<span aria-hidden>·</span> {running > 0 && `${running} running`}
						{running > 0 && failures > 0 && " · "}
						{failures > 0 && <span className="text-destructive">{failures} failed</span>}
					</span>
				)
			}
			open={!closed}
			onToggle={() => setClosed(shut => !shut)}
			fold="overview.jobs.fold"
		>
			<ul aria-label="Background jobs" className="flex flex-col gap-0.5 p-1">
				{jobs.map(job => (
					<JobRow key={job.id} job={job} />
				))}
			</ul>
		</OverviewSection>
	);
}

function JobRow({ job }: { job: BackgroundJob }) {
	const [open, setOpen] = useState(() => failed(job));
	// A job that fails while you look unfolds once, and stays as you leave it after that.
	const wasFailed = useRef(failed(job));
	useEffect(() => {
		if (failed(job) && !wasFailed.current) setOpen(true);
		wasFailed.current = failed(job);
	}, [job]);
	const now = useSecond();
	const elapsed = (job.endedAt ?? now) - job.startedAt;
	const progress = jobProgress(job.lines);
	const last = job.lines.at(-1);
	return (
		<li className="rounded-md">
			<button
				type="button"
				{...activityControl("overview.job")}
				aria-expanded={open}
				onClick={() => setOpen(shown => !shown)}
				className={cn(
					"group/job grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 gap-y-[3px] rounded-md px-2 py-[7px] text-left text-[13px] leading-5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
					open && "rounded-b-none bg-muted",
				)}
			>
				<JobIcon job={job} open={open} />
				<span className="flex min-w-0 items-baseline gap-2">
					<span className="min-w-0 truncate font-mono text-xs" title={job.command}>
						{job.command}
					</span>
					<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
						{jobDuration(elapsed)}
						{job.state === "done" && <span className="text-emerald-700 dark:text-emerald-400"> · done</span>}
						{failed(job) && <span className="text-destructive"> · {job.state === "cancelled" ? "stopped" : "failed"}</span>}
					</span>
				</span>
				{progress && <ProgressLine job={job} progress={progress} elapsed={elapsed} />}
				{last && !open && <span className={cn("col-start-2 min-w-0 truncate font-mono text-[11.5px] leading-[17px] text-muted-foreground", failed(job) && "text-destructive")}>{last}</span>}
			</button>
			{open && <JobTail job={job} />}
		</li>
	);
}

/** A terminal, with a spinner on its corner while the job runs, else a green or red dot cut out of it. */
function JobIcon({ job, open }: { job: BackgroundJob; open: boolean }) {
	const ring = cn("bg-background group-hover/job:bg-muted", open && "bg-muted");
	return (
		<span className="relative flex h-5 items-center text-muted-foreground">
			<IconConsole className="size-4" />
			{job.state === "running" ? (
				<span role="img" aria-label="running" className={cn("absolute -right-[5px] -bottom-px size-2.5 rounded-full border-[1.5px] border-foreground/20 border-t-foreground motion-safe:animate-spin", ring)} />
			) : (
				<span className={cn("absolute -right-1 bottom-0 flex size-2.5 items-center justify-center rounded-full", ring)}>
					<span role="img" aria-label={job.state === "done" ? "exited 0" : job.state === "cancelled" ? "stopped" : "failed"} className={cn("size-[7px] rounded-full", job.state === "done" ? "bg-emerald-500" : "bg-red-500")} />
				</span>
			)}
		</span>
	);
}

/** The bar, filled to the count done, red for the failed share when the output counts failures, then `N/M`, and pass and fail counts with the time left under it. */
function ProgressLine({ job, progress, elapsed }: { job: BackgroundJob; progress: JobProgress; elapsed: number }) {
	const { done, total, passed, failed: fails } = progress;
	const failShare = fails !== null ? Math.min(fails, done) : 0;
	const left = job.state === "running" ? jobTimeLeft(progress, elapsed) : null;
	const meta = passed !== null || fails !== null || left !== null;
	return (
		<>
			<span className="col-start-2 flex items-center gap-2 text-xs text-muted-foreground">
				<span role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="flex h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
					<span className={cn("h-full transition-[width] duration-400 motion-reduce:transition-none", job.state === "done" ? "bg-emerald-500" : "bg-foreground")} style={{ width: `${((done - failShare) / total) * 100}%` }} />
					{failShare > 0 && <span className="h-full bg-red-500" style={{ width: `${(failShare / total) * 100}%` }} />}
				</span>
				<span className="shrink-0 tabular-nums text-foreground">
					{done}
					<span className="text-muted-foreground">/{total}</span>
				</span>
			</span>
			{meta && (
				<span className="col-start-2 min-w-0 truncate text-xs text-muted-foreground tabular-nums">
					{passed !== null && `${passed} pass`}
					{passed !== null && fails !== null && " · "}
					{fails !== null && <span className={cn(fails > 0 && "text-destructive")}>{fails} fail</span>}
					{left !== null && `${passed !== null || fails !== null ? " · " : ""}${timeLeft(left)}`}
				</span>
			)}
		</>
	);
}

/** The job's last lines, wrapped, scrolled to the newest as they come while you have not scrolled up. */
function JobTail({ job }: { job: BackgroundJob }) {
	const box = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	useEffect(() => {
		const el = box.current;
		if (el && pinned.current) el.scrollTop = el.scrollHeight;
	}, [job.lines]);
	return (
		<div className="rounded-b-md bg-muted px-2 pb-2 pl-[34px]">
			<div
				ref={box}
				onScroll={event => {
					const el = event.currentTarget;
					pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
				}}
				className="max-h-[262px] overflow-auto rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground"
			>
				{job.lines.length === 0 ? (
					<div className="text-muted-foreground">No output yet</div>
				) : (
					job.lines.map((line, i) => (
						<div key={i} className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
							{line}
						</div>
					))
				)}
			</div>
			<div className="mt-1.5 text-xs text-muted-foreground">
				{job.id} · last {job.lines.length} lines
			</div>
		</div>
	);
}
