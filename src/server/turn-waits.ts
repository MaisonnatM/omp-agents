/** Whether each live session's main agent waits on work it started, from the tool calls of its running turn. */
import { isObject } from "../json";

/** The tools a main agent calls to wait on its subagents or background jobs rather than to work itself. */
const WAITING_TOOLS: ReadonlySet<string> = new Set(["task", "wait"]);
/** The events that change a turn's tool calls; every other event, `message_update` above all, passes untouched. */
const TRACKED_EVENTS: ReadonlySet<unknown> = new Set(["tool_execution_start", "tool_execution_end", "agent_start", "agent_end"]);

/** A running turn's tool calls in flight, tool call id to tool name, and whether it waits; a session with neither has no entry. */
interface Turn {
	calls: Map<string, string>;
	waiting: boolean;
}

export class TurnWaits {
	readonly #turns = new Map<string, Turn>();

	/** Session `instanceId` reported main-agent `event`; whether that changed {@link waits}' answer for it. */
	heard(instanceId: string, event: unknown): boolean {
		if (!isObject(event) || !TRACKED_EVENTS.has(event.type)) return false;
		const before = this.waits(instanceId);
		if (event.type === "agent_start" || event.type === "agent_end") {
			// A turn cut off ends with no `tool_execution_end` for the calls it left running.
			this.#turns.delete(instanceId);
		} else if (typeof event.toolCallId === "string") {
			const turn = this.#turns.get(instanceId) ?? { calls: new Map<string, string>(), waiting: false };
			if (event.type === "tool_execution_start" && typeof event.toolName === "string") turn.calls.set(event.toolCallId, event.toolName);
			else turn.calls.delete(event.toolCallId);
			// Between two calls the turn keeps its answer, so a main agent that thinks between waits stays waiting.
			if (turn.calls.size > 0) turn.waiting = [...turn.calls.values()].every(name => WAITING_TOOLS.has(name));
			if (turn.waiting || turn.calls.size > 0) this.#turns.set(instanceId, turn);
			else this.#turns.delete(instanceId);
		}
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
}
