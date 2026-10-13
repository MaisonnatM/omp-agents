import type { StartingPrompt } from "./transcript";

/** A main-agent prompt sent but not acked yet; {@link PromptTurn.send} opens it. */
export interface PendingPrompt {
	/** Ends the wait for the ack, whether it came or the send failed. */
	close(): void;
	/** Holds `prompt` as starting when omp admitted it while idle and neither its turn nor its `prompt_result` came first. */
	acked(prompt: StartingPrompt | null): void;
}

/** What {@link PromptTurn.interrupt} marks before an abort; after it, `unsent` holds the starting prompt unless its turn showed it. */
export interface StopMark {
	readonly unsent: () => StartingPrompt[];
}

/**
 * The main agent's turn and the prompt omp admitted while idle that has not shown yet.
 * omp acks a prompt before its turn starts, and its `agent_start`, user message, or `prompt_result` may each come before the ack.
 */
export class PromptTurn {
	/** Whether a turn runs, from its `agent_start` to its terminal `agent_end`. */
	#running = false;
	#starting: StartingPrompt | null = null;
	/** The `agent_start`s seen, so a prompt whose turn started before its ack came back is not held as starting. */
	#turnStarts = 0;
	/** The live user messages seen, so Stop can tell whether the starting prompt's turn showed it. */
	#promptsShown = 0;
	/** The ids of the `prompt_result`s that came while a prompt waited for its ack: its own may come first. */
	#resultsBeforeAck: Set<string> | null = null;

	get running(): boolean {
		return this.#running;
	}

	get starting(): StartingPrompt | null {
		return this.#starting;
	}

	get busy(): boolean {
		return this.#running || this.#starting !== null;
	}

	send(): PendingPrompt {
		const idle = !this.busy;
		const starts = this.#turnStarts;
		const settled = (this.#resultsBeforeAck = new Set<string>());
		return {
			close: () => {
				this.#resultsBeforeAck = null;
			},
			acked: prompt => {
				if (prompt && idle && this.#turnStarts === starts && !settled.has(prompt.id)) this.#starting = prompt;
			},
		};
	}

	/** A `prompt_result`: the prompt ended, with or without a turn. */
	result(id: string): void {
		this.#resultsBeforeAck?.add(id);
		if (id === this.#starting?.id) this.#starting = null;
	}

	/** A live user message: the starting prompt shows in the conversation now. */
	shown(): void {
		this.#promptsShown++;
		this.#starting = null;
	}

	turnStarted(): void {
		this.#turnStarts++;
		this.#running = true;
	}

	turnEnded(): void {
		this.#running = false;
	}

	/** Lets go of the starting prompt, as an abort, a branch, a move, or the process exiting does. */
	release(): void {
		this.#starting = null;
	}

	/** Marks a stop before its abort, so the prompt omp drops unrun can go back to the composer after it. */
	interrupt(): StopMark {
		const starting = this.#starting;
		const shown = this.#promptsShown;
		return { unsent: () => (starting && this.#promptsShown === shown ? [starting] : []) };
	}
}
