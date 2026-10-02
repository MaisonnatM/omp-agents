/** What a Collab host reports of its agents, and where their transcripts are on disk. */
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "./json";
import type { AgentStatus } from "./shared";

const AGENT_STATUSES: Record<string, AgentStatus> = { running: "running", idle: "idle", parked: "parked", aborted: "aborted" };

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
		const parsed = typeof status === "string" ? AGENT_STATUSES[status] : undefined;
		if (typeof id !== "string" || !parsed) return [];
		return [
			{
				id,
				type: typeof displayName === "string" ? displayName : "agent",
				isMain: kind === "main",
				parentId: typeof parentId === "string" ? parentId : null,
				status: parsed,
				createdAt: typeof createdAt === "number" ? createdAt : 0,
			},
		];
	});
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
		const path = join(sessionFile.replace(/\.jsonl$/, ""), ...ancestors, `${agentId}.jsonl`);
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
