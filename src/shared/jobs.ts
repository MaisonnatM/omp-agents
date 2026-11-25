/** A live session's background jobs: the omp `bash` calls that moved to the background or ran with `async`, and how far their output says they got. */

/** How a job stands: running, exited 0, exited otherwise or timed out, or stopped. */
export type JobState = "running" | "done" | "failed" | "cancelled";

export interface BackgroundJob {
	/** omp's job id, such as `bg_3`. */
	id: string;
	command: string;
	/** ms since the epoch, when its call started, or when the server first heard of it. */
	startedAt: number;
	endedAt: number | null;
	state: JobState;
	/** Its last {@link JOB_TAIL_LINES} non-empty output lines, oldest first. */
	lines: string[];
}

/** How many output lines a job keeps and its row shows unfolded. */
export const JOB_TAIL_LINES = 15;

/** The progress a job's latest output lines report: a count done of a total, and pass and fail counts, each `null` when none parses. */
export interface JobProgress {
	done: number;
	total: number;
	passed: number | null;
	failed: number | null;
}

/** How many of the latest lines {@link jobProgress} reads. */
const PROGRESS_LINES = 5;
/** `23/60`, not part of a path, date, or decimal such as `a/1/2`, `2026/11/24`, `1.2/3`, or `1/2.5`. */
const SLASH = /(?<![\w./:-])(\d+)\s*\/\s*(\d+)(?![\w/]|\.\d)/;
/** `23 of 60`. */
const OF = /\b(\d+)\s+of\s+(\d+)\b/i;
const PASSED = /\b(\d+)\s+(?:pass|passed|passing|ok)\b/i;
const FAILED = /\b(\d+)\s+(?:fail|failed|failing|failures?|errors?)\b/i;

/**
 * The progress `lines` report, from the newest of its last few lines that holds a count `N/M` or `N of M` with N at most M: that count, with
 * pass and fail counts such as `21 pass` or `2 failed` from the same line or a newer one; `null` when none of those lines holds a count.
 */
export function jobProgress(lines: readonly string[]): JobProgress | null {
	const latest = lines.slice(-PROGRESS_LINES);
	for (let i = latest.length - 1; i >= 0; i--) {
		const match = SLASH.exec(latest[i]) ?? OF.exec(latest[i]);
		if (!match) continue;
		const done = Number(match[1]);
		const total = Number(match[2]);
		if (total === 0 || done > total) continue;
		const newer = latest.slice(i).reverse();
		return { done, total, passed: firstCount(newer, PASSED), failed: firstCount(newer, FAILED) };
	}
	return null;
}

function firstCount(lines: readonly string[], pattern: RegExp): number | null {
	for (const line of lines) {
		const match = pattern.exec(line);
		if (match) return Number(match[1]);
	}
	return null;
}

/** The time left at the pace so far, in ms, once some of the total is done; `null` before. */
export function jobTimeLeft(progress: JobProgress, elapsedMs: number): number | null {
	return progress.done > 0 && progress.done < progress.total ? (elapsedMs / progress.done) * (progress.total - progress.done) : null;
}
