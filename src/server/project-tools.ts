/**
 * The tools a project's coordinator gets, served by this server over omp's RPC (`RpcClient`'s `customTools`): start a
 * worker session, list the workers, read one's last reply, message one, answer its question, and end it. Each is bound
 * to its project, and refuses to act once the project is archived.
 */
import type { RpcHostTool } from "../omp/modules";
import type { Project, ProjectUpdate, Worker, WorkerId, WorkerPhase } from "../shared/projects";
import { DASHBOARD_PROMPT_PREFIX } from "../shared/transcript";

/** How the coordinator asks for a worker; every field but the title and prompt may be `null` for the default. */
export interface WorkerSpec {
	title: string;
	prompt: string;
	/** Absolute, `~/`, or relative to the project's workspace; `null` for the workspace. */
	cwd: string | null;
	/** A new branch's name, `none` to work in the directory as it is, or `null` for a branch the dashboard names. */
	branch: string | null;
	/** `provider/id`. */
	model: string | null;
	thinking: string | null;
	skill: string | null;
}

/** A started worker, or its place in the queue. */
export type WorkerStarted = { kind: "started"; workerId: WorkerId; cwd: string } | { kind: "queued"; position: number };

/** What the tools ask of the project runner. Each throws an error the coordinator reads when it cannot do what it asks. */
export interface ProjectControl {
	project(projectId: string): Project | undefined;
	phaseOf(worker: Worker): WorkerPhase;
	/** The questions live worker `worker` waits on. */
	questionsOf(worker: Worker): { id: string; title: string }[];
	/** Starts a worker, or queues it while the project runs its most workers. */
	startWorker(project: Project, spec: WorkerSpec): Promise<WorkerStarted>;
	/** Prompts the worker, resuming it first when it does not run. */
	messageWorker(worker: Worker, text: string): Promise<void>;
	/** Answers question `requestId` of live worker `worker`. */
	answerWorker(worker: Worker, requestId: string, answer: string): void;
	/** Ends the worker's session as End session does. */
	endWorker(worker: Worker): Promise<void>;
}

/** How much of a worker's last reply an update quotes; read_worker gives the whole. */
export const REPLY_QUOTE_CHARS = 2000;

/** An object schema whose every property is required, as omp's strict host tools need. */
function schema(properties: Record<string, Record<string, unknown>>): Record<string, unknown> {
	return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const NULLABLE = { type: ["string", "null"] };

function text(params: Record<string, unknown>, name: string): string {
	const value = params[name];
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
	return value;
}

function optional(params: Record<string, unknown>, name: string): string | null {
	const value = params[name];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function workerOf(project: Project, id: string): Worker {
	const worker = project.workers.find(candidate => candidate.id === id.trim());
	if (!worker) throw new Error(`Project ${project.name} has no worker ${id}. list_workers names them.`);
	return worker;
}

/**
 * The message that brings `updates` to the coordinator of `project`, in order; a finished turn quotes the worker's last
 * reply. It starts with {@link DASHBOARD_PROMPT_PREFIX}, so the page hides it from the user.
 */
export function updateText(project: Project, updates: readonly ProjectUpdate[]): string {
	const who = (workerId: WorkerId): string => {
		const worker = project.workers.find(candidate => candidate.id === workerId);
		return worker ? `${worker.id} ${JSON.stringify(worker.title)}` : workerId;
	};
	const lines = updates.map(update => {
		switch (update.kind) {
			case "finished": {
				const reply = project.workers.find(candidate => candidate.id === update.workerId)?.lastReply?.text.trim() ?? "";
				if (!reply) return `- ${who(update.workerId)} finished its turn with no text reply.`;
				const cut = reply.length > REPLY_QUOTE_CHARS;
				const quoted = (cut ? reply.slice(0, REPLY_QUOTE_CHARS) : reply).replace(/\n/g, "\n  ");
				return `- ${who(update.workerId)} finished its turn. Last reply${cut ? ` (truncated to ${REPLY_QUOTE_CHARS} chars)` : ""}:\n  ${quoted}`;
			}
			case "asked":
				return `- ${who(update.workerId)} asks (request ${update.requestId}): ${JSON.stringify(update.question)} Answer it with answer_worker when you can; otherwise tell the user, who can answer it in the dashboard.`;
			case "stopped":
				return `- ${who(update.workerId)} stopped.`;
			case "restarted":
				return update.workers.length === 0
					? "- The dashboard restarted. No worker was running."
					: `- The dashboard restarted and stopped ${update.workers.map(who).join(", ")}. message_worker resumes one that should go on.`;
			case "event":
				return `- ${update.source}: ${update.title}${update.url ? ` (${update.url})` : ""}${update.text.trim() ? `\n  ${update.text.trim().replace(/\n/g, "\n  ")}` : ""}`;
			default: {
				const unhandled: never = update;
				return unhandled;
			}
		}
	});
	return [`${DASHBOARD_PROMPT_PREFIX} Project update.`, ...lines, "Use read_worker for more, message_worker to reply."].join("\n");
}

/** The tools of project `projectId`'s coordinator. */
export function projectTools(projectId: string, control: ProjectControl): RpcHostTool[] {
	const project = (): Project => {
		const found = control.project(projectId);
		if (!found) throw new Error("This project no longer exists.");
		if (found.archived) throw new Error(`Project ${found.name} is archived, so its workers can no longer be started, read, or messaged. Tell the user.`);
		return found;
	};
	return [
		{
			name: "start_worker",
			label: "Start worker",
			description: [
				"Start a worker: a new omp session in the dashboard that takes `prompt` as its first message and works on its own.",
				"Write the prompt so it stands alone: the goal, the context it needs, where to look, and what to report back.",
				"`cwd` is the directory it starts in: absolute, ~/, relative to the project's workspace, or null for the workspace itself.",
				"In a git checkout each worker works on a new branch in a worktree of its own; `branch` names it, `none` shares the directory as it is, null lets the dashboard name it.",
				"`model` (provider/id), `thinking`, and `skill` choose how it runs; null keeps the default.",
				"When the project already runs its most workers at once, the worker waits in a queue and starts when one finishes.",
				"You are told when it finishes its turn or asks a question; do not poll.",
			].join(" "),
			parameters: schema({
				title: { type: "string", description: "A short title for the worker, as the sidebar shows it." },
				prompt: { type: "string", description: "The worker's first message." },
				cwd: { ...NULLABLE, description: "An absolute, ~/, or workspace-relative directory to start in, or null for the project's workspace." },
				branch: { ...NULLABLE, description: "A new branch name, none to work without a branch of its own, or null for one the dashboard names." },
				model: { ...NULLABLE, description: "provider/id, such as anthropic/claude-haiku-5-5, or null for omp's default." },
				thinking: { ...NULLABLE, description: "A thinking level such as low or high, or null for the model's default." },
				skill: { ...NULLABLE, description: "A skill its first message goes through, or null for none." },
			}),
			loadMode: "essential",
			async execute(params) {
				const title = text(params, "title").replace(/\s+/g, " ").trim();
				const started = await control.startWorker(project(), {
					title,
					prompt: text(params, "prompt"),
					cwd: optional(params, "cwd"),
					branch: optional(params, "branch"),
					model: optional(params, "model"),
					thinking: optional(params, "thinking"),
					skill: optional(params, "skill"),
				});
				return started.kind === "started"
					? `Started ${started.workerId} ${JSON.stringify(title)} in ${started.cwd}. You are told when it finishes or asks; do not poll.`
					: `Queued ${JSON.stringify(title)} at position ${started.position}: the project runs its most workers at once. It starts when one finishes; do not poll.`;
			},
		},
		{
			name: "list_workers",
			label: "List workers",
			description: "List this project's workers: id, title, phase (working, asking, idle, interrupted, ended), directory, and the first line of the last reply; then the queued ones.",
			parameters: schema({}),
			loadMode: "essential",
			async execute() {
				const { workers, queue, maxWorkers } = project();
				if (workers.length === 0 && queue.length === 0) return "No workers yet. start_worker starts one.";
				const rows = workers.map(worker => [worker.id, worker.title, control.phaseOf(worker), worker.cwd, worker.lastReply?.text.trim().split("\n", 1)[0] ?? ""].join(" · "));
				const queued = queue.map((entry, index) => `queued ${index + 1} · ${entry.title}`);
				return [...rows, ...queued, `At most ${maxWorkers} work at once.`].join("\n");
			},
		},
		{
			name: "read_worker",
			label: "Read worker",
			description: "Read one worker's whole last reply and the questions it waits on, with their request ids.",
			parameters: schema({ worker: { type: "string", description: "The worker's id, such as w1." } }),
			loadMode: "essential",
			async execute(params) {
				const worker = workerOf(project(), text(params, "worker"));
				const questions = control.questionsOf(worker);
				return [
					`${worker.id} ${JSON.stringify(worker.title)} · ${control.phaseOf(worker)} · ${worker.cwd}`,
					worker.lastReply ? `Last reply, ${worker.lastReply.at}:\n${worker.lastReply.text}` : "No finished turn yet.",
					...questions.map(question => `Waits on request ${question.id}: ${question.title}`),
				].join("\n");
			},
		},
		{
			name: "message_worker",
			label: "Message worker",
			description: "Send a worker a message, as the user would. A running worker gets it after its current turn; a stopped one is resumed first.",
			parameters: schema({
				worker: { type: "string", description: "The worker's id, such as w1." },
				text: { type: "string", description: "The message." },
			}),
			loadMode: "essential",
			async execute(params) {
				const worker = workerOf(project(), text(params, "worker"));
				await control.messageWorker(worker, text(params, "text"));
				return `Sent to ${worker.id}. You are told when it finishes or asks; do not poll.`;
			},
		},
		{
			name: "answer_worker",
			label: "Answer worker",
			description: [
				"Answer a question a worker asks through its ask dialog, as the user would in the dashboard.",
				"For a choice, answer with one option's label; for a yes or no question, yes or no; for text, the text.",
				"Answer only what you know from the goal, the notes, or the user; otherwise tell the user.",
			].join(" "),
			parameters: schema({
				worker: { type: "string", description: "The worker's id, such as w1." },
				requestId: { type: "string", description: "The request id from the update or read_worker." },
				answer: { type: "string", description: "The answer." },
			}),
			loadMode: "essential",
			async execute(params) {
				const worker = workerOf(project(), text(params, "worker"));
				control.answerWorker(worker, text(params, "requestId").trim(), text(params, "answer"));
				return `Answered ${worker.id}. You are told when it finishes or asks again; do not poll.`;
			},
		},
		{
			name: "end_worker",
			label: "End worker",
			description: "End a worker's session, as End session does: its process stops and its worktree is removed when nothing in it would be lost. Its branch stays.",
			parameters: schema({ worker: { type: "string", description: "The worker's id, such as w1." } }),
			loadMode: "essential",
			async execute(params) {
				const worker = workerOf(project(), text(params, "worker"));
				await control.endWorker(worker);
				return `Ended ${worker.id}.`;
			},
		},
	];
}
