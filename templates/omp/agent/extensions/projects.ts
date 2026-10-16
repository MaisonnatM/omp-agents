// omp-agents projects: tells a session that belongs to a dashboard project its role and where the project's notes and
// the user's notes are, at every prompt, so the text survives compaction. A coordinator plans and starts workers through
// the tools the dashboard serves it, and may edit or write only those notes. The dashboard keeps `projects.json`; this only reads it.
// The dashboard loads this file with `-e` when it is not installed here, so it must not be loaded twice.
// Both hooks find the role by the session's id. A subagent that runs in the session (an advisor, a `/tan` clone) acts in
// its role; a `task` subagent, whose transcript omp writes inside its parent's session directory, takes its parent's role.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const PROJECTS_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "projects.json");
const DATA_DIR = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "omp-agents");
const NOTES_ROOT = join(DATA_DIR, "projects");
// `userNotesDir` in `src/paths.ts`; change both together.
const USER_NOTES = join(DATA_DIR, "user");

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
	reviewCadence?: string;
}

/** A project session's role; `subagent` when the session is a `task` subagent of the project's session. */
export type Role = { project: Project; worker: Worker | null; subagent: boolean };

function readProjects(): Project[] {
	try {
		const parsed = JSON.parse(readFileSync(PROJECTS_FILE, "utf8")) as { projects?: Project[] };
		return Array.isArray(parsed.projects) ? parsed.projects : [];
	} catch {
		return [];
	}
}

/** The project of session `sessionId` among `projects`, and its worker record when it is one; `null` for none. */
export function findRole(projects: readonly Project[], sessionId: string): Omit<Role, "subagent"> | null {
	for (const project of projects) {
		if (project.coordinator?.sessionId === sessionId) return { project, worker: null };
		const worker = project.workers?.find(candidate => candidate.sessionId === sessionId);
		if (worker) return { project, worker };
	}
	return null;
}

/**
 * The ids of the sessions `sessionFile` runs under, nearest first: omp writes a subagent's transcript as
 * `<parent>/<agent>.jsonl` beside `<parent>.jsonl`, whose name is `<time>_<session id>`.
 */
export function ancestorSessionIds(sessionFile: string, exists: (path: string) => boolean = existsSync): string[] {
	const ids: string[] = [];
	let current = resolve(sessionFile);
	for (let depth = 0; depth < 8; depth++) {
		const parent = `${dirname(current)}.jsonl`;
		if (!exists(parent)) break;
		const name = basename(parent, ".jsonl");
		ids.push(name.slice(name.indexOf("_") + 1));
		current = parent;
	}
	return ids;
}

type SessionContext = { sessionManager: { getSessionId(): string; getSessionFile?(): string | undefined } };

/** The role of the session `ctx` runs, its own or, for a `task` subagent, its nearest project ancestor's. */
function roleOf(ctx: SessionContext): Role | null {
	const projects = readProjects();
	if (projects.length === 0) return null;
	const own = findRole(projects, ctx.sessionManager.getSessionId());
	if (own) return { ...own, subagent: false };
	const file = ctx.sessionManager.getSessionFile?.();
	for (const id of file ? ancestorSessionIds(file) : []) {
		const inherited = findRole(projects, id);
		if (inherited) return { ...inherited, subagent: true };
	}
	return null;
}

/** The role text for `role`, whose project's notes are in `notes` and the user's, which every project shares, in `user`. */
export function roleText({ project, worker, subagent }: Role, notes: string, user: string): string {
	const shared = [
		`The project's notes, shared by every session of the project, are in ${notes}. Read ${join(notes, "notes.md")} first: the goal, the decisions, and the index of the other notes.`,
		"Record what lasts there: a decision or preference about this project only under Decisions in notes.md, how to build, run, and test the work in docs/testing.md, research and its sources in docs/research.md, and link any new file from notes.md.",
		`The user's own notes, shared by every project, are in ${user}. Read ${join(user, "preferences.md")}, and any workflow in ${join(user, "workflows")} that fits the task.`,
		"Record there a preference that holds beyond this project; one about this project only goes in the project's notes.md.",
	].join(" ");
	if (subagent) {
		const parent = worker ? `worker ${worker.id} (${JSON.stringify(worker.title)})` : "the coordinator";
		return [
			`You are a subagent of ${parent} of the omp-agents project ${JSON.stringify(project.name)}.`,
			shared,
			worker ? "" : "Like the coordinator, you never change the project's code: your edit and write calls outside the project's and the user's notes are blocked, and so are shell redirections there and git or Graphite writes.",
		]
			.filter(Boolean)
			.join(" ");
	}
	if (!worker) {
		const cadence = project.reviewCadence?.trim() || "every PR";
		return [
			`You are the coordinator of the omp-agents project ${JSON.stringify(project.name)}.`,
			"Your job is to plan, delegate, and report: start_worker starts a worker session on a prompt that stands alone, on its own branch, model, skill, or preset when you name them, and queues it when the project already runs its most workers.",
			"Read only the notes, the workers' reports, and what a quick look answers; start a worker for anything more, investigation, research, reviews, and browser checks included, with a prompt that says what to report back.",
			"list_workers, read_worker, and message_worker follow and steer the workers; answer_worker answers a question a worker asks, and end_worker ends a worker that is done.",
			"Never change the project's code yourself, in any way: your edit and write calls outside the project's and the user's notes, shell redirections there, and git or Graphite writes are blocked, so start a worker for any change.",
			shared,
			"Record the user's feedback and decisions as soon as you hear them, and tell each worker what of it applies.",
			"When a note has held across several workers, promote it into the repository through a worker, as an AGENTS.md line or a skill, and list it under Promoted in notes.md.",
			"For work that spans several pull requests, such as a migration, keep internal/checklist.md current: each item, its status, its worker, and its pull request; start the next batch as pull requests merge, and move finished items to archived.md.",
			"Each outside event, such as a pull request's checks or a Linear issue, is also a file in inbox/; once you have handled it, delete the file or move its line to archived.md.",
			`The user's review cadence is: ${cadence}. Ask the user to review a pull request only when that cadence calls for it; always ask for a failure you cannot resolve.`,
			"Updates about your workers and your subscriptions arrive as user messages that start with [omp-agents]; never poll for them.",
			"The user never sees those messages, so when you act on one, say which worker reported what.",
			"Once the plan is clear, start the workers at once: never ask the user to approve the plan or to say go, and never write a prompt for the user to paste or start themselves.",
			"Ask the user only for a decision that is genuinely theirs, such as the scope, a product choice, or a merge when the review cadence calls for it, never for permission to start.",
			"When a worker's work is done, its pull request merged or closed or its report leaving nothing for it to do, call end_worker for it in the same turn, then report; the dashboard also ends an idle worker on its own once its pull requests are merged.",
			"Tell the user what the workers found and what is done, and tell them when a worker waits on a question you cannot answer.",
		].join(" ");
	}
	return [
		`You are worker ${worker.id} (${JSON.stringify(worker.title)}) of the omp-agents project ${JSON.stringify(project.name)}, started by its coordinator agent.`,
		shared,
		"Before your final report, add to docs/testing.md or docs/research.md whatever you learned that the next worker would need, and say in the report which notes you changed.",
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

/** Whether `path`, from `cwd`, is in one of the notes directories `roots` or the session's scratch space. */
function inNotes(path: string, cwd: string, roots: readonly string[]): boolean {
	if (SCRATCH_SCHEMES.some(scheme => path.startsWith(scheme)) || path === "/dev/null") return true;
	const file = resolve(cwd, path.replace(/^~(?=\/|$)/, homedir()));
	return roots.some(root => file === root || file.startsWith(root + sep));
}

/**
 * `command` with each quoted string unquoted and its shell operators and spaces made `_`, so a `>` or `|` inside quotes,
 * as in `rg "=>"`, reads as text; good enough to find verbs, operands, and redirections, not a shell parser.
 */
function unquoted(command: string): string {
	return command.replace(/"([^"]*)"|'([^']*)'/g, (_match, double: string | undefined, single: string | undefined) => (double ?? single ?? "").replace(/[<>|;&\s]/g, "_") || "_");
}

/** A segment's words, without leading `NAME=value` assignments. */
function words(segment: string): string[] {
	const all = segment.split(/\s+/).filter(Boolean);
	while (all.length > 1 && /^\w+=/.test(all[0] ?? "")) all.shift();
	return all;
}

const GIT_WRITES: Record<string, true> = { commit: true, push: true, checkout: true, switch: true, reset: true, rebase: true, merge: true, "cherry-pick": true, revert: true, stash: true, apply: true, am: true, restore: true, clean: true, add: true, rm: true, mv: true, tag: true, worktree: true, pull: true };
const GT_READS: Record<string, true> = { log: true, ls: true, ll: true, status: true, info: true, "branch-info": true, parent: true, children: true, trunk: true, "--help": true, help: true };

/**
 * Why a coordinator's shell `command`, run in `cwd`, writes outside the notes directories `roots`; `null` when it does not
 * seem to. A nudge that reminds the coordinator of its role, not a boundary: it catches a redirection or `tee` to a file outside them,
 * and git and Graphite commands that change the checkout or a branch. Any other command runs.
 */
export function shellWrite(command: string, cwd: string, roots: readonly string[]): string | null {
	const plain = unquoted(command);
	for (const redirect of plain.matchAll(/(?<![0-9&<>=-])(?:[0-9]?>>?|&>>?)\s*(?!&)([^\s;|&<>]+)/g)) {
		const target = redirect[1] ?? "";
		if (!inNotes(target, cwd, roots)) return `it redirects output to ${target}`;
	}
	for (const segment of plain.split(/&&|\|\||[;|\n]/)) {
		const [verb = "", ...rest] = words(segment);
		const operands = rest.filter(word => !word.startsWith("-"));
		if (verb === "tee") {
			const target = operands.find(path => !inNotes(path, cwd, roots));
			if (target !== undefined) return `tee writes ${target}`;
		} else if (verb === "git") {
			// `-C <dir>` and `-c <name=value>` take a value before the subcommand.
			const sub = rest.find((word, index) => !word.startsWith("-") && rest[index - 1] !== "-C" && rest[index - 1] !== "-c");
			if (sub && Object.hasOwn(GIT_WRITES, sub)) return `git ${sub} changes the checkout or a branch`;
		} else if (verb === "gt") {
			const sub = operands[0];
			if (sub && !Object.hasOwn(GT_READS, sub)) return `gt ${sub} changes a branch`;
		}
	}
	return null;
}

export default function projects(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const role = roleOf(ctx);
		if (!role) return;
		return { systemPrompt: [...event.systemPrompt, roleText(role, join(NOTES_ROOT, role.project.id), USER_NOTES)] };
	});
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write" && event.toolName !== "bash") return;
		const role = roleOf(ctx);
		if (!role || role.worker) return;
		const notes = join(NOTES_ROOT, role.project.id);
		const roots = [notes, USER_NOTES];
		const where = `the project's notes in ${notes} and the user's notes in ${USER_NOTES}`;
		const input = event.input as Record<string, unknown>;
		if (event.toolName === "bash") {
			const why = typeof input.command === "string" ? shellWrite(input.command, typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : ctx.cwd, roots) : null;
			if (why === null) return;
			return { block: true, reason: `A project coordinator does not change code, and ${why}, outside ${where}. Start a worker with start_worker for the change.` };
		}
		const paths = targets(input);
		// A call whose files cannot be read, such as one in a format this does not know, is refused rather than let through.
		if (paths.length === 0) {
			return { block: true, reason: `A project coordinator does not change code, and this ${event.toolName} call names no file the guard can check against ${where}. Start a worker with start_worker for the change.` };
		}
		const outside = paths.find(path => !inNotes(path, ctx.cwd, roots));
		if (outside === undefined) return;
		return { block: true, reason: `A project coordinator does not change code: ${outside} is outside ${where}. Start a worker with start_worker for the change.` };
	});
}
