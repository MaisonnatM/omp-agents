/** Whether each live session's main agent waits on work it started, from the tool calls of its running turn. */
import { isObject } from "../json";

/** The tools a main agent calls to wait on its subagents or background jobs rather than to work itself. */
const WAITING_TOOLS: ReadonlySet<string> = new Set(["task", "wait"]);

/** A running turn's tool calls in flight, tool call id to tool name, and whether it waits. */
interface Turn {
	calls: Map<string, string>;
	waiting: boolean;
}

export class TurnWaits {
	/** The turn of each session whose main agent called a tool since its turn started, by instance id. */
	readonly #turns = new Map<string, Turn>();

	/** Session `instanceId` reported main-agent `event`; whether that changed {@link waits}' answer for it. */
	heard(instanceId: string, event: unknown): boolean {
		if (!isObject(event)) return false;
		const before = this.waits(instanceId);
		switch (event.type) {
			case "agent_start":
			case "agent_end":
				// A turn cut off ends with no `tool_execution_end` for the calls it left running.
				this.#turns.delete(instanceId);
				break;
			case "tool_execution_start":
				if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") return false;
				this.#turn(instanceId).calls.set(event.toolCallId, event.toolName);
				break;
			case "tool_execution_end":
				if (typeof event.toolCallId !== "string") return false;
				this.#turn(instanceId).calls.delete(event.toolCallId);
				break;
			default:
				return false;
		}
		const turn = this.#turns.get(instanceId);
		// Between two calls the turn keeps its answer, so a main agent that thinks between waits stays waiting.
		if (turn && turn.calls.size > 0) turn.waiting = [...turn.calls.values()].every(name => WAITING_TOOLS.has(name));
		return this.waits(instanceId) !== before;
	}

	/**
	 * Whether session `instanceId`'s running turn waits: every tool call in flight is a {@link WAITING_TOOLS} call, or, with none in
	 * flight, the last calls were; the next other tool call or the turn's end stops it.
	 */
	waits(instanceId: string): boolean {
		return this.#turns.get(instanceId)?.waiting ?? false;
	}

	forget(instanceId: string): void {
		this.#turns.delete(instanceId);
	}

	#turn(instanceId: string): Turn {
		let turn = this.#turns.get(instanceId);
		if (!turn) {
			turn = { calls: new Map(), waiting: false };
			this.#turns.set(instanceId, turn);
		}
		return turn;
	}
}
