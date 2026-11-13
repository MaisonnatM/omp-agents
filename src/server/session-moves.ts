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
	/** Whether `request`'s session stays in its directory: a Bot's conversation stays in its Bot's. */
	staysPut(request: StartRequest): boolean;
	/** Lets a session run in `dir`, or throws while the project code there is not trusted as it is now. */
	admit(dir: string): Promise<void>;
}

export class SessionMoves {
	readonly #deps: SessionMovesDeps;
	/**
	 * The move each call took, by tool call id, until the call's end hands it over: a reattached session gets its tools before
	 * it is listed, and its events, held until then, are what reach it after.
	 */
	readonly #taken = new Map<string, TakenMove>();

	constructor(deps: SessionMovesDeps) {
		this.#deps = deps;
	}

	/** How `request` joins the server as session `instanceId`: with its own move tool, unless its session stays put. */
	join(request: StartRequest, instanceId: string): SessionJoin {
		return { rpc: this.#deps.staysPut(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#toolFor(instanceId)] }, attach() {} };
	}

	/** A live session reported `event`: the successful end of a move call hands its session the move for the turn's end. */
	heard(event: unknown): void {
		if (!isObject(event) || event.type !== "tool_execution_end" || typeof event.toolCallId !== "string") return;
		const move = this.#taken.get(event.toolCallId);
		if (!move) return;
		this.#taken.delete(event.toolCallId);
		if (event.isError !== true) this.#deps.session(move.caller)?.moveAfterTurn(move.dir);
	}

	/** Session `instanceId` exited, ending any move call it left running. */
	exited(instanceId: string): void {
		for (const [toolCallId, move] of this.#taken) if (move.caller === instanceId) this.#taken.delete(toolCallId);
	}

	/** The move tool of session `caller`. */
	#toolFor(caller: string): RpcHostTool {
		return {
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
			execute: async ({ path }, { toolCallId, signal }) => {
				if (typeof path !== "string" || !/^\s*[/~]/.test(path)) throw new Error("path must be absolute or start with ~.");
				const dir = await directoryOf(path);
				if (!dir) throw new Error(`Not a directory: ${path.trim()}`);
				// A move reloads omp in the new directory, which runs that project's code as a start would.
				await this.#deps.admit(dir);
				if (signal.aborted) throw new Error("This turn ended before the move was taken; nothing moves.");
				this.#taken.set(toolCallId, { caller, dir });
				return `When this turn ends, the dashboard moves this session to ${dir} and reloads its context files. End your turn now; do not work in ${dir} before the move.`;
			},
		};
	}
}

/** A move a call took: the session that called it, and the directory it moves to. */
interface TakenMove {
	caller: string;
	dir: string;
}

