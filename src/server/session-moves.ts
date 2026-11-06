/**
 * The `move_session` tool a dashboard session gets, which moves the session to another directory as the user's `/move`
 * does, once the turn that asked for it ends: omp refuses `/move` while a turn runs.
 */
import type { DashboardSession } from "../dashboard-session";
import { isObject } from "../json";
import type { RpcHostTool } from "../omp/module-types/rpc";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { directoryOf } from "../paths";
import type { StartRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const MOVE_SESSION_TOOL = "move_session";

export interface SessionMovesDeps {
	/** Dashboard session `instanceId`, while it runs. */
	session(instanceId: string): Pick<DashboardSession, "moveAfterTurn"> | undefined;
	/** Whether `request`'s session stays in its directory: a Bot's conversation stays in its Bot's, and a personal session in the personal directory. */
	staysPut(request: StartRequest): boolean;
	/** Lets a session run in `dir`, or throws while the project code there is not trusted as it is now. */
	admit(dir: string): Promise<void>;
}

export class SessionMoves {
	readonly #deps: SessionMovesDeps;
	/**
	 * Each move call a session started, by tool call id, until its end or the end of its turn or session. Its start names
	 * the session, since the tool cannot know it: a reattached session gets its tools before it is listed.
	 */
	readonly #calls = new Map<string, MoveCall>();
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
			// A move reloads omp in the new directory, which runs that project's code as a start would.
			await this.#deps.admit(dir);
			// A turn cut off while the directory was checked forgot this call, so nothing would hand its move over.
			const call = this.#calls.get(toolCallId);
			if (!call) throw new Error("This turn ended before the move was taken; nothing moves.");
			call.dir = dir;
			return `When this turn ends, the dashboard moves this session to ${dir} and reloads its context files. End your turn now; do not work in ${dir} before the move.`;
		},
	};

	constructor(deps: SessionMovesDeps) {
		this.#deps = deps;
	}

	/** How `request` joins the server: with the move tool, unless its session stays put. */
	join(request: StartRequest): SessionJoin {
		return { rpc: this.#deps.staysPut(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#tool] }, attach() {} };
	}

	/**
	 * Session `instanceId` reported `event`: the successful end of a move call hands the session its move for the turn's
	 * end, and the end of a turn forgets the session's move calls it cut off.
	 */
	heard(instanceId: string, event: unknown): void {
		if (!isObject(event)) return;
		if (event.type === "agent_end") return this.#forget(instanceId);
		if (typeof event.toolCallId !== "string") return;
		if (event.type === "tool_execution_start" && event.toolName === MOVE_SESSION_TOOL) this.#calls.set(event.toolCallId, { caller: instanceId, dir: null });
		if (event.type !== "tool_execution_end") return;
		const call = this.#calls.get(event.toolCallId);
		this.#calls.delete(event.toolCallId);
		if (call?.dir && event.isError !== true) this.#deps.session(instanceId)?.moveAfterTurn(call.dir);
	}

	/** Session `instanceId` exited, ending any move call it left running. */
	exited(instanceId: string): void {
		this.#forget(instanceId);
	}

	#forget(instanceId: string): void {
		for (const [toolCallId, call] of this.#calls) if (call.caller === instanceId) this.#calls.delete(toolCallId);
	}
}

/** A move call: the session that started it, and the directory the tool took, `null` until it takes one. */
interface MoveCall {
	caller: string;
	dir: string | null;
}
