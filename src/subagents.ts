/** What a Collab host reports of its agents, and where their transcripts are on disk. */
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject, nonEmptyStr, oneOf, str } from "./json";
import { oneLine } from "./session-entries";
import { AGENT_STATUSES, type AgentStatus, type ContextUsage } from "./shared/sessions";

const isAgentStatus = oneOf(AGENT_STATUSES);

export interface HostAgent {
	id: string;
	type: string;
	isMain: boolean;
	parentId: string | null;
	status: AgentStatus;
	/** ms since the epoch. */
	createdAt: number;
}

export function parseAgents(value: unknown): HostAgent[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(raw => {
		if (!isObject(raw)) return [];
		const { id, displayName, kind, parentId, status, createdAt } = raw;
		if (typeof id !== "string" || !isAgentStatus(status)) return [];
		return [
			{
				id,
				type: typeof displayName === "string" ? displayName : "agent",
				isMain: kind === "main",
				parentId: typeof parentId === "string" ? parentId : null,
				status,
				createdAt: typeof createdAt === "number" ? createdAt : 0,
			},
		];
	});
}

export const SUBAGENT_LIFECYCLE = "task:subagent:lifecycle";
export const SUBAGENT_PROGRESS = "task:subagent:progress";

/** omp's subagent lifecycle and progress statuses, as the roster's agent statuses. */
const FRAME_STATUSES: Record<string, AgentStatus> = {
	started: "running",
	pending: "running",
	running: "running",
	completed: "idle",
	failed: "aborted",
	aborted: "aborted",
};

/** What one `task:subagent:*` frame says of its subagent; a field the frame does not carry is absent. */
export interface SubagentFrame {
	id: string;
	kind?: string;
	status?: AgentStatus;
	/** One line saying what the subagent is doing. */
	activity?: string;
	sessionFile?: string;
}

/** A `task:subagent:lifecycle` or `task:subagent:progress` payload (a Collab `bus` frame or an RPC subagent frame), or `null` when it names no subagent. */
export function parseSubagentFrame(channel: unknown, payload: unknown): SubagentFrame | null {
	if ((channel !== SUBAGENT_LIFECYCLE && channel !== SUBAGENT_PROGRESS) || !isObject(payload)) return null;
	const progress = channel === SUBAGENT_PROGRESS && isObject(payload.progress) ? payload.progress : null;
	const body = progress ?? payload;
	if (typeof body.id !== "string") return null;
	const text = progress
		? (nonEmptyStr(progress.currentToolIntent) ??
			nonEmptyStr(progress.lastIntent) ??
			nonEmptyStr(progress.description) ??
			nonEmptyStr(payload.assignment) ??
			nonEmptyStr(progress.task))
		: channel === SUBAGENT_LIFECYCLE
			? nonEmptyStr(payload.description)
			: undefined;
	const frame: SubagentFrame = { id: body.id };
	const kind = str(payload.agent);
	if (kind !== undefined) frame.kind = kind;
	const status = typeof body.status === "string" ? FRAME_STATUSES[body.status] : undefined;
	if (status) frame.status = status;
	if (text) frame.activity = oneLine(text);
	const sessionFile = str(payload.sessionFile);
	if (sessionFile !== undefined) frame.sessionFile = sessionFile;
	return frame;
}

/** omp's `ContextUsage` (a Collab state frame or an RPC state), as the roster's context numbers. */
export function contextOf(value: unknown): ContextUsage | null {
	if (!isObject(value)) return null;
	const { tokens, contextWindow } = value;
	return typeof tokens === "number" && typeof contextWindow === "number" && contextWindow > 0
		? { tokens, window: contextWindow }
		: null;
}

/** The directory omp writes a transcript's subagent transcripts in: its path without `.jsonl`. */
export const artifactsDir = (transcript: string): string => transcript.replace(/\.jsonl$/, "");

/** Every subagent transcript of `transcript`, at any depth under its {@link artifactsDir}, sorted by path. */
export async function subagentFiles(transcript: string): Promise<string[]> {
	const dir = artifactsDir(transcript);
	const names = await readdir(dir, { recursive: true }).catch(() => []);
	return names
		.filter(name => name.endsWith(".jsonl"))
		.sort()
		.map(name => join(dir, name));
}

/**
 * Where omp writes a subagent's transcript: `<id>.jsonl` in its parent's artifacts
 * directory, which is the parent's transcript path without `.jsonl`. A subagent that
 * outlived a `/new` or `/resume` stays registered but wrote beside the session it
 * started in; when the expected file is missing, a search looks for it among the
 * project's sessions and reports once it found it.
 */
export class SubagentFiles {
	/** Where each agent's file is expected, for the session file that was computed against; the registry changing drops them. */
	readonly #expected = new Map<string, { sessionFile: string; path: string }>();
	/** Transcripts found away from where omp writes them, and the agents already looked for. */
	readonly #found = new Map<string, string>();
	readonly #searched = new Set<string>();
	#closed = false;
	readonly #onFound: () => void;

	/** `onFound` hears of each transcript the search finds. */
	constructor(onFound: () => void) {
		this.#onFound = onFound;
	}

	/** The registry changed from `previous` to `current`: forget what was computed from it, and what was learned of agents that left. */
	update(previous: readonly HostAgent[], current: readonly HostAgent[]): void {
		this.#expected.clear();
		const listed = new Set(current.map(agent => agent.id));
		for (const { id } of previous) {
			if (listed.has(id)) continue;
			this.#found.delete(id);
			this.#searched.delete(id);
		}
	}

	/** Stop reporting finds; the guest it serves ended. */
	close(): void {
		this.#closed = true;
	}

	/** The transcript of subagent `agentId` among `agents` of the session in `sessionFile`, or `null` when no such subagent is listed. */
	pathOf(sessionFile: string, agentId: string, agents: readonly HostAgent[]): string | null {
		const found = this.#found.get(agentId);
		if (found) return found;
		const cached = this.#expected.get(agentId);
		if (cached?.sessionFile === sessionFile) return cached.path;
		const byId = new Map(agents.filter(agent => !agent.isMain).map(agent => [agent.id, agent]));
		const agent = byId.get(agentId);
		if (!agent) return null;
		const ancestors: string[] = [];
		for (let parent = agent.parentId ? byId.get(agent.parentId) : undefined; parent; parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
			ancestors.unshift(parent.id);
		}
		const path = join(artifactsDir(sessionFile), ...ancestors, `${agentId}.jsonl`);
		this.#expected.set(agentId, { sessionFile, path });
		if (!existsSync(path) && !this.#searched.has(agentId)) {
			this.#searched.add(agentId);
			void this.#search(dirname(sessionFile), agent);
		}
		return path;
	}

	/** The newest `<id>.jsonl` under the project's sessions written since the subagent registered. */
	async #search(projectDir: string, agent: HostAgent): Promise<void> {
		let newest: { path: string; mtimeMs: number } | null = null;
		for await (const rel of new Bun.Glob(`*/**/${agent.id}.jsonl`).scan({ cwd: projectDir })) {
			const path = join(projectDir, rel);
			const { mtimeMs } = await stat(path);
			if (mtimeMs >= agent.createdAt && (!newest || mtimeMs > newest.mtimeMs)) newest = { path, mtimeMs };
		}
		if (!newest || this.#closed) return;
		this.#found.set(agent.id, newest.path);
		this.#onFound();
	}
}
