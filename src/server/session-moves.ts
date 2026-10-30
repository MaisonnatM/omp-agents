/**
 * The `move_session` tool a dashboard session gets, which moves the session to another directory as the user's `/move`
 * does, once the turn that asked for it ends: omp refuses `/move` while a turn runs.
 */
import type { DashboardSession } from "../dashboard-session";
import { isObject } from "../json";
import type { RpcHostTool } from "../omp/modules";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { directoryOf } from "../paths";
import type { StartRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const MOVE_SESSION_TOOL = "move_session";

export interface SessionMovesDeps {
	/** Dashboard session `instanceId`, while it runs. */
	session(instanceId: string): Pick<DashboardSession, "moveAfterTurn"> | undefined;
	/** Whether `request` starts or resumes a Bot's conversation, which stays in its Bot's directory. */
	isBot(request: StartRequest): boolean;
}

export class SessionMoves {
	readonly #deps: SessionMovesDeps;
	/**
	 * The directory of each call the tool took, by tool call id, until the call's end names its session: the tool cannot
	 * know its session, since a reattached session gets its tools before it is listed.
	 */
	readonly #called = new Map<string, string>();
	/** The instance id of each move call a session started, by tool call id, so a turn cut off before the call's end forgets it. */
	readonly #callers = new Map<string, string>();
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

	/**
	 * Session `instanceId` reported `event`: the successful end of a move call hands the session its move for the turn's
	 * end, and the end of a turn forgets the session's move calls it cut off.
	 */
	heard(instanceId: string, event: unknown): void {
		if (!isObject(event)) return;
		if (event.type === "agent_end") return this.#forget(instanceId);
		if (typeof event.toolCallId !== "string") return;
		if (event.type === "tool_execution_start" && event.toolName === MOVE_SESSION_TOOL) this.#callers.set(event.toolCallId, instanceId);
		if (event.type !== "tool_execution_end") return;
		const dir = this.#called.get(event.toolCallId);
		this.#called.delete(event.toolCallId);
		this.#callers.delete(event.toolCallId);
		if (dir !== undefined && event.isError !== true) this.#deps.session(instanceId)?.moveAfterTurn(dir);
	}

	/** Session `instanceId` exited, ending any move call it left running. */
	exited(instanceId: string): void {
		this.#forget(instanceId);
	}

	#forget(instanceId: string): void {
		for (const [toolCallId, caller] of this.#callers) {
			if (caller !== instanceId) continue;
			this.#callers.delete(toolCallId);
			this.#called.delete(toolCallId);
		}
	}
}
