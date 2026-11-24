/**
 * Each live session's background jobs, from its main agent's `bash` tool events: omp keeps sending a backgrounded call's
 * `tool_execution_update` frames, tagged with `details.async`, until the job settles, after the call itself returned.
 */
import { isObject } from "../json";
import { type BackgroundJob, JOB_TAIL_LINES, type JobState } from "../shared/jobs";

/** Eval runs that `scripts/evals/run.ts` starts already show among the session's subagents, so the job that runs the harness is left out. */
const EVAL_HARNESS = /\bscripts\/evals\/run\.ts\b/;

const STATES: Record<string, JobState> = { running: "running", completed: "done", failed: "failed", cancelled: "cancelled" };

/** Whether `command` runs the eval harness, whose runs the Subagents list shows instead. */
export const runsEvalHarness = (command: string): boolean => EVAL_HARNESS.test(command);

/** A frame's text as its last non-empty lines, colors stripped. */
function tail(text: string): string[] {
	return Bun.stripANSI(text)
		.split(/\r?\n/)
		.map(line => line.trimEnd())
		.filter(line => line.trim() !== "")
		.slice(-JOB_TAIL_LINES);
}

export class SessionJobs {
	/** Each session's jobs by job id, in start order, by instance id. */
	readonly #jobs = new Map<string, Map<string, BackgroundJob>>();
	/** When each `bash` call in flight started, by tool call id. */
	readonly #starts = new Map<string, number>();
	readonly #now: () => number;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	/** Session `instanceId`'s main agent reported `event`; whether that changed its jobs. */
	heard(instanceId: string, event: unknown): boolean {
		if (!isObject(event) || event.toolName !== "bash" || typeof event.toolCallId !== "string") return false;
		if (event.type === "tool_execution_start") {
			this.#starts.set(event.toolCallId, this.#now());
			return false;
		}
		if (event.type === "tool_execution_end") {
			this.#starts.delete(event.toolCallId);
			return false;
		}
		if (event.type !== "tool_execution_update" || !isObject(event.partialResult) || !isObject(event.partialResult.details)) return false;
		const async = event.partialResult.details.async;
		if (!isObject(async) || async.type !== "bash" || typeof async.jobId !== "string" || typeof async.state !== "string") return false;
		const state = STATES[async.state];
		const command = isObject(event.args) && typeof event.args.command === "string" ? event.args.command : "";
		if (!state || runsEvalHarness(command)) return false;
		const content = event.partialResult.content;
		const text = Array.isArray(content) ? content.flatMap(block => (isObject(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n") : "";
		let jobs = this.#jobs.get(instanceId);
		if (!jobs) {
			jobs = new Map();
			this.#jobs.set(instanceId, jobs);
		}
		const before = jobs.get(async.jobId);
		// A frame after the job settled, such as a late preview, changes nothing.
		if (before && before.state !== "running") return false;
		const now = this.#now();
		const lines = tail(text);
		const job: BackgroundJob = {
			id: async.jobId,
			command,
			startedAt: before?.startedAt ?? this.#starts.get(event.toolCallId) ?? now,
			endedAt: state === "running" ? null : now,
			state,
			lines: lines.length > 0 || !before ? lines : before.lines,
		};
		if (before && before.state === job.state && before.lines.join("\n") === job.lines.join("\n")) return false;
		jobs.set(job.id, job);
		return true;
	}

	/** Every session's jobs, oldest first, leaving out sessions with none. */
	all(): Record<string, BackgroundJob[]> {
		return Object.fromEntries([...this.#jobs].map(([instanceId, jobs]) => [instanceId, [...jobs.values()]]));
	}

	forget(instanceId: string): boolean {
		return this.#jobs.delete(instanceId);
	}
}
