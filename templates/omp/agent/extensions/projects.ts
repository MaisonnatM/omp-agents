// omp-agents projects: tells a session that belongs to a dashboard project its role and where the project's notes are,
// at every prompt, so the text survives compaction. A coordinator plans and starts workers through the tools the
// dashboard serves it, and may edit or write only the notes. The dashboard keeps `projects.json`; this only reads it.
// The dashboard loads this file with `-e` when it is not installed here, so it must not be loaded twice.
// Both hooks find the role by the session's id, so a subagent that runs in the session (an advisor, a `/tan` clone)
// acts in its role, and one with a session of its own (a `task` subagent) has none.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const PROJECTS_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "projects.json");
const NOTES_ROOT = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "omp-agents", "projects");

// Internal URLs that name the session's own scratch space, not the project's code.
const SCRATCH_SCHEMES = ["local://", "artifact://"];

// The subset of `src/shared/projects.ts` this reads; change both together.
interface Worker {
	id: string;
	title: string;
	sessionId: string;
}
interface Project {
	id: string;
	name: string;
	coordinator: { sessionId: string };
	workers: Worker[];
}

type Role = { project: Project; worker: Worker | null };

/** The project session `sessionId` belongs to, and its worker record when it is one; `null` for none. */
function roleOf(sessionId: string): Role | null {
	let projects: Project[];
	try {
		const parsed = JSON.parse(readFileSync(PROJECTS_FILE, "utf8")) as { projects?: Project[] };
		projects = Array.isArray(parsed.projects) ? parsed.projects : [];
	} catch {
		return null;
	}
	for (const project of projects) {
		if (project.coordinator?.sessionId === sessionId) return { project, worker: null };
		const worker = project.workers?.find(candidate => candidate.sessionId === sessionId);
		if (worker) return { project, worker };
	}
	return null;
}

/** The role text for `role`, whose notes are in `notes`. */
function roleText({ project, worker }: Role, notes: string): string {
	const shared = `The project's notes, shared by every session of the project, are in ${notes}. Read ${join(notes, "README.md")} first. Record what lasts there: how to build and test the work in testing.md, the user's preferences in preferences.md, research and its sources in research.md, and link any new file from README.md.`;
	if (!worker) {
		return [
			`You are the coordinator of the omp-agents project ${JSON.stringify(project.name)}.`,
			"You plan the work and delegate it: start_worker starts a worker session on a prompt that stands alone, and list_workers, read_worker, and message_worker follow and steer the workers.",
			"Never change the project's code yourself: your edit and write calls outside the notes are blocked, so start a worker for any change.",
			shared,
			"Updates about your workers arrive as user messages that start with [omp-agents]; never poll for them.",
			"Tell the user what the workers found and what is done, and tell them when a worker waits on a question only they can answer.",
		].join(" ");
	}
	return [
		`You are worker ${worker.id} (${JSON.stringify(worker.title)}) of the omp-agents project ${JSON.stringify(project.name)}, started by its coordinator agent.`,
		shared,
		"The coordinator reads only your last reply, so end each turn with a report that stands alone: what you did, what you found, and what is left.",
		"When you need a decision, end your turn with the question rather than asking through the ask tool.",
	].join(" ");
}

/** The files an `edit` or `write` call touches: its `path`, and each `[path#TAG]` header of a hashline edit; empty when it names none this can read. */
function targets(input: Record<string, unknown>): string[] {
	const paths = typeof input.path === "string" ? [input.path] : [];
	if (typeof input.input === "string") for (const match of input.input.matchAll(/^\[(.+)#[0-9A-Fa-f]{4}\]$/gm)) if (match[1]) paths.push(match[1]);
	return paths;
}

export default function projects(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const role = roleOf(ctx.sessionManager.getSessionId());
		if (!role) return;
		return { systemPrompt: [...event.systemPrompt, roleText(role, join(NOTES_ROOT, role.project.id))] };
	});
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const role = roleOf(ctx.sessionManager.getSessionId());
		if (!role || role.worker) return;
		const notes = join(NOTES_ROOT, role.project.id);
		const paths = targets(event.input as Record<string, unknown>);
		// A call whose files cannot be read, such as one in a format this does not know, is refused rather than let through.
		if (paths.length === 0) {
			return { block: true, reason: `A project coordinator does not change code, and this ${event.toolName} call names no file the guard can check against the project's notes in ${notes}. Start a worker with start_worker for the change.` };
		}
		const outside = paths.find(path => {
			if (SCRATCH_SCHEMES.some(scheme => path.startsWith(scheme))) return false;
			const file = resolve(ctx.cwd, path.replace(/^~(?=\/)/, homedir()));
			return !file.startsWith(notes + sep);
		});
		if (outside === undefined) return;
		return { block: true, reason: `A project coordinator does not change code: ${outside} is outside the project's notes in ${notes}. Start a worker with start_worker for the change.` };
	});
}
