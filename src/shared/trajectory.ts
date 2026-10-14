/** A transcript's trajectory: what the model received and spent on each turn, which the pane's Trajectory tab shows. */

/** The tokens one model call used and what it cost, in US dollars, as omp records each call's `usage`. */
export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
	input: a.input + b.input,
	output: a.output + b.output,
	cacheRead: a.cacheRead + b.cacheRead,
	cacheWrite: a.cacheWrite + b.cacheWrite,
	cost: a.cost + b.cost,
});

export const totalTokens = (usage: TokenUsage): number => usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

/** A text the trajectory carries cut to its first characters; `cut` counts the characters left out. */
export interface Clipped {
	text: string;
	cut: number;
}

/** One thing that reached the model, or that it did, in file order. */
export type TurnStep =
	/** What the user typed: a `/skill:` prompt's text after the skill's name, which `skill` names; a command and its output for `!`. */
	| { kind: "prompt"; body: Clipped; skill: string | null }
	/**
	 * Context the model got besides the prompt: an extension's `custom_message` (`source` is its `customType`, such as
	 * `skill-prompt`), a `developer` message such as a system reminder, a synthetic user message, or the rules a
	 * `ttsr_injection` added. `attribution` says who started it, when omp records it.
	 */
	| { kind: "injection"; source: string; attribution: "user" | "agent" | null; body: Clipped }
	/** One model request, an assistant message: its model, usage, why it stopped, and how long it took in ms, when omp records it. */
	| { kind: "request"; model: string; usage: TokenUsage; stopReason: string; durationMs: number | null }
	| { kind: "thinking"; body: Clipped }
	| { kind: "reply"; body: Clipped }
	/**
	 * A tool call: its arguments as JSON, then once it ran, its result's size in bytes of text and its count of images,
	 * and its duration from omp's start marker to its result; `durationMs` is `null` without a marker.
	 */
	| {
			kind: "tool";
			callId: string;
			name: string;
			args: Clipped;
			status: "running" | "ok" | "error";
			blocked?: boolean;
			result?: Clipped;
			resultBytes: number | null;
			resultImages: number;
			durationMs: number | null;
	  }
	/** A model call outside the conversation, a `model_usage` entry, such as the auto-thinking classifier or a cache warm-up. */
	| { kind: "side-call"; purpose: string; model: string; usage: TokenUsage }
	| { kind: "model"; model: string; role: string | null }
	| { kind: "thinking-level"; level: string }
	| { kind: "compaction"; tokensBefore: number | null };

/**
 * One turn: from a prompt to the next one. `steps` also holds what reached the model between the last request of the
 * turn before and the prompt, such as a model or thinking change or an injected notice, ahead of the prompt step.
 * `usage` sums every request and side call of the turn. `id` is the prompt's entry id, or `start` for requests made
 * before any prompt, a turn without a prompt step.
 */
export interface Turn {
	id: string;
	/** From 1, in file order. */
	index: number;
	/** When the prompt was written, in ms since the epoch; `null` for a turn without one. */
	at: number | null;
	steps: TurnStep[];
	usage: TokenUsage;
	requests: number;
	toolCalls: number;
}
