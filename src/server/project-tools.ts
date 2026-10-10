/**
 * The tools a project's coordinator gets, served by this server over omp's RPC (`RpcClient`'s `customTools`): start a
 * worker session, list the workers, read one's last reply, and message one. Each is bound to its project, and refuses
 * to act once the project is archived.
 */
import type { RpcHostTool } from "../omp/modules";
import type { Project, ProjectUpdate, Worker, WorkerId, WorkerPhase } from "../shared/projects";

/** What the tools ask of the project runner. Each throws an error the coordinator reads when it cannot do what it asks. */
export interface ProjectControl {
	project(projectId: string): Project | undefined;
	phaseOf(worker: Worker): WorkerPhase;
	/** The titles of the questions live worker `worker` waits on the user for. */
	questionsOf(worker: Worker): string[];
	/** Starts a worker in `cwd`, absolute, `~/`, or relative to the project's workspace, which `null` names. */
	startWorker(project: Project, spec: { title: string; prompt: string; cwd: string | null }): Promise<{ workerId: WorkerId; cwd: string }>;
	/** Prompts the worker, resuming it first when it does not run. */
	messageWorker(worker: Worker, text: string): Promise<void>;
}

/** How much of a worker's last reply an update quotes; read_worker gives the whole. */
export const REPLY_QUOTE_CHARS = 2000;

/** An object schema whose every property is required, as omp's strict host tools need. */
function schema(properties: Record<string, Record<string, unknown>>): Record<string, unknown> {
	return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function text(params: Record<string, unknown>, name: string): string {
	const value = params[name];
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
	return value;
}

function workerOf(project: Project, id: string): Worker {
	const worker = project.workers.find(candidate => candidate.id === id.trim());
	if (!worker) throw new Error(`Project ${project.name} has no worker ${id}. list_workers names them.`);
	return worker;
}

/** The message that brings `updates` to the coordinator of `project`, in order; a finished turn quotes the worker's last reply. */
export function updateText(project: Project, updates: readonly ProjectUpdate[]): string {
	const lines = updates.map(update => {
		const worker = project.workers.find(candidate => candidate.id === update.workerId);
		const who = worker ? `${worker.id} ${JSON.stringify(worker.title)}` : update.workerId;
		switch (update.kind) {
			case "finished": {
				const reply = worker?.lastReply?.text.trim() ?? "";
				if (!reply) return `- ${who} finished its turn with no text reply.`;
				const cut = reply.length > REPLY_QUOTE_CHARS;
				const quoted = (cut ? reply.slice(0, REPLY_QUOTE_CHARS) : reply).replace(/\n/g, "\n  ");
				return `- ${who} finished its turn. Last reply${cut ? ` (truncated to ${REPLY_QUOTE_CHARS} chars)` : ""}:\n  ${quoted}`;
			}
			case "asked":
				return `- ${who} asks: ${JSON.stringify(update.question)} Only the user can answer it in the dashboard; tell them.`;
			case "stopped":
				return `- ${who} stopped.`;
			default: {
				const unhandled: never = update;
				return unhandled;
			}
		}
	});
	return ["[omp-agents] Project update.", ...lines, "Use read_worker for more, message_worker to reply."].join("\n");
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
				"You are told when it finishes its turn or asks a question; do not poll.",
			].join(" "),
			parameters: schema({
				title: { type: "string", description: "A short title for the worker, as the sidebar shows it." },
				prompt: { type: "string", description: "The worker's first message." },
				cwd: { type: ["string", "null"], description: "An absolute, ~/, or workspace-relative directory to start in, or null for the project's workspace." },
			}),
			loadMode: "essential",
			async execute(params) {
				const title = text(params, "title").replace(/\s+/g, " ").trim();
				const cwd = typeof params.cwd === "string" && params.cwd.trim() ? params.cwd.trim() : null;
				const { workerId, cwd: dir } = await control.startWorker(project(), { title, prompt: text(params, "prompt"), cwd });
				return `Started ${workerId} ${JSON.stringify(title)} in ${dir}. You are told when it finishes or asks; do not poll.`;
			},
		},
		{
			name: "list_workers",
			label: "List workers",
			description: "List this project's workers: id, title, phase (working, asking, idle, interrupted, ended), directory, and the first line of the last reply.",
			parameters: schema({}),
			loadMode: "essential",
			async execute() {
				const { workers } = project();
				if (workers.length === 0) return "No workers yet. start_worker starts one.";
				return workers.map(worker => [worker.id, worker.title, control.phaseOf(worker), worker.cwd, worker.lastReply?.text.trim().split("\n", 1)[0] ?? ""].join(" · ")).join("\n");
			},
		},
		{
			name: "read_worker",
			label: "Read worker",
			description: "Read one worker's whole last reply and the questions it waits on the user for.",
			parameters: schema({ worker: { type: "string", description: "The worker's id, such as w1." } }),
			loadMode: "essential",
			async execute(params) {
				const worker = workerOf(project(), text(params, "worker"));
				const questions = control.questionsOf(worker);
				return [
					`${worker.id} ${JSON.stringify(worker.title)} · ${control.phaseOf(worker)} · ${worker.cwd}`,
					worker.lastReply ? `Last reply, ${worker.lastReply.at}:\n${worker.lastReply.text}` : "No finished turn yet.",
					...(questions.length > 0 ? [`Waits on the user for: ${questions.join("; ")}`] : []),
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
	];
}
