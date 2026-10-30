/**
 * The `move_session` tool a dashboard session gets, which moves the session to another directory as the user's `/move`
 * does, once the turn that asked for it ends: omp refuses `/move` while a turn runs.
 */
import type { DashboardSession } from "../dashboard-session";
import { errorText, isObject } from "../json";
import type { RpcHostTool } from "../omp/modules";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { directoryOf } from "../paths";
import type { StartRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const MOVE_SESSION_TOOL = "move_session";

export interface SessionMovesDeps {
	/** Dashboard session `instanceId`, while it runs. */
	session(instanceId: string): Pick<DashboardSession, "status" | "prompt"> | undefined;
	/** Whether `request` starts or resumes a Bot's conversation, which stays in its Bot's directory. */
	isBot(request: StartRequest): boolean;
	/** Shows `text` as an error in session `instanceId`'s conversation. */
	note(instanceId: string, text: string): void;
}

export class SessionMoves {
	readonly #deps: SessionMovesDeps;
	/**
	 * The directory of each call the tool took, by tool call id, until the call's end names its session: the tool cannot
	 * know its session, since a reattached session gets its tools before it is listed.
	 */
	readonly #called = new Map<string, string>();
	/** The directory each session moves to when its turn ends, by instance id; a later call in the turn replaces it. */
	readonly #pending = new Map<string, string>();
	readonly #tool: RpcHostTool = {
		name: MOVE_SESSION_TOOL,
		label: "Move session",
		description: [
			"Move this session to another directory, as the user's /move does, when the user asks you to work in another repository or directory.",
			"The dashboard moves it once your turn ends, then omp reloads the context files of the new directory.",
			"`path` is absolute or starts with ~.",
		].join(" "),
		parameters: {
			type: "object",
			properties: { path: { type: "string", description: "The directory to move to, absolute or starting with ~." } },
			required: ["path"],
			additionalProperties: false,
		},
		loadMode: "essential",
		execute: async ({ path }, { toolCallId }) => {
			if (typeof path !== "string" || !/^\s*[/~]/.test(path)) throw new Error("path must be absolute or start with ~.");
			const dir = await directoryOf(path);
			if (!dir) throw new Error(`Not a directory: ${path.trim()}`);
			this.#called.set(toolCallId, dir);
			return `When this turn ends, the dashboard moves this session to ${dir} and reloads its context files. End your turn now; do not work in ${dir} before the move.`;
		},
	};

	constructor(deps: SessionMovesDeps) {
		this.#deps = deps;
	}

	/** How `request` joins the server: with the move tool, unless it is a Bot's conversation. */
	join(request: StartRequest): SessionJoin {
		return { rpc: this.#deps.isBot(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#tool] }, attach() {} };
	}

	/** Session `instanceId` reported `event`; the successful end of a move call makes the move wait on the turn's end. */
	heard(instanceId: string, event: unknown): void {
		if (!isObject(event) || event.type !== "tool_execution_end" || typeof event.toolCallId !== "string") return;
		const dir = this.#called.get(event.toolCallId);
		if (dir === undefined) return;
		this.#called.delete(event.toolCallId);
		if (event.isError !== true) this.#pending.set(instanceId, dir);
	}

	/**
	 * Session `instanceId` ended a turn: its waiting move goes in as `/move`. The session reports the end before it shows
	 * idle, so the move waits a microtask; a session busy again by then keeps it for its next turn's end.
	 */
	turnEnded(instanceId: string): void {
		if (!this.#pending.has(instanceId)) return;
		queueMicrotask(() => {
			const dir = this.#pending.get(instanceId);
			const session = this.#deps.session(instanceId);
			if (dir === undefined || session?.status !== "idle") return;
			this.#pending.delete(instanceId);
			session.prompt(null, `/move ${dir}`, [], "steer").catch((err: unknown) => this.#deps.note(instanceId, `Could not move to ${dir}: ${errorText(err)}`));
		});
	}

	exited(instanceId: string): void {
		this.#pending.delete(instanceId);
	}
}
