/**
 * **Ask about this**: a side question about text selected in a transcript or a pull request's diff, answered by one model
 * call apart from every session. The model sees the passage, where it came from, and the discussion so far, nothing else.
 */

/** The longest passage a discussion quotes; the page cuts a longer selection to this. */
export const MAX_DISCUSSION_QUOTE = 20_000;
/** The longest question the server takes. */
export const MAX_DISCUSSION_QUESTION = 4_000;
/** The longest answer a follow-up carries back. */
export const MAX_DISCUSSION_ANSWER = 40_000;
/** The most earlier questions a follow-up carries back. */
export const MAX_DISCUSSION_TURNS = 20;
/** The longest name of where a passage came from. */
export const MAX_DISCUSSION_SOURCE = 500;

/** One earlier question of a discussion with the answer it got. */
export interface DiscussionTurn {
	question: string;
	answer: string;
}

/** One question, with everything the model sees for it. */
export interface DiscussionRequest {
	/** Where the passage came from, as the panel names it: `session “Fix the login bug”` or a pull request and its file. */
	source: string;
	quote: string;
	/** The questions asked before this one, oldest first. */
	turns: DiscussionTurn[];
	question: string;
}

/** How an answer reaches the page: the model answering first, then its text in pieces, then the end. */
export type DiscussionEvent =
	| { kind: "model"; model: string }
	| { kind: "text"; text: string }
	/** `error` is why no full answer came; a stopped answer ends with none. */
	| { kind: "end"; error: string | null };

export const DISCUSSION_SYSTEM_PROMPT =
	"You answer a side question about a passage the user selected while reviewing a coding agent's work. " +
	"You see only the passage, where it came from, and this discussion: not the rest of the session, its files, or any tools. " +
	"When the passage is not enough to answer, say what is missing. Answer briefly, in Markdown.";

/** The one user message the model gets for `request`. */
export function discussionPrompt({ source, quote, turns, question }: DiscussionRequest): string {
	const earlier = turns.map(turn => `Question: ${turn.question}\n\nAnswer: ${turn.answer}`);
	return [
		`The user selected this passage from ${source}:`,
		`<passage>\n${quote}\n</passage>`,
		...(earlier.length > 0 ? ["Earlier in this discussion:", ...earlier] : []),
		`Question: ${question}`,
	].join("\n\n");
}

/** What **Send to session** queues in the session the passage came from: the passage quoted, then the answer it ends on. */
export function sessionMessage(quote: string, answer: string): string {
	const quoted = quote
		.trim()
		.split("\n")
		.map(line => (line ? `> ${line}` : ">"))
		.join("\n");
	return `About this passage:\n\n${quoted}\n\nA side discussion concluded:\n\n${answer.trim()}`;
}
