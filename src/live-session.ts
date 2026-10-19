/** What the server asks of a running session, whether it is a terminal session it joined or one it started itself. */
import { isObject } from "./json";
import type { HostSnapshot } from "./omp/collab";
import type { Delivery, MessageQueue, PromptImage, RosterHost, SessionFacts, UserAnswer, WithdrawnMessage } from "./shared/sessions";
import { splitSuggestions } from "./transcript";

type WithoutKeys<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A roster row before the server adds the session's `cwdDisplay`, its unread turn, and its {@link SessionFacts}. */
export type LiveRow = WithoutKeys<RosterHost, "cwdDisplay" | "unread" | keyof SessionFacts>;

/** What a live session reports as it runs. */
export type LiveUpdate =
	/** Its roster row changed: control phase, subagents, or what a subagent is doing. */
	| { kind: "roster" }
	/** A live agent event of the session; it streams what the session file does not hold yet. */
	| { kind: "event"; event: unknown }
	/** An out-of-band line for the session (`agentId` null) or one of its subagents. */
	| { kind: "note"; agentId: string | null; level: "info" | "warning" | "error"; text: string }
	| TurnUpdate;

/** The main agent's turn started, or ran to its end; `reply` is its last text without suggested prompts, `null` when it ended on none. */
export type TurnUpdate = { kind: "turn-started" } | { kind: "turn-ended"; reply: string | null };

/** The text of the last assistant message among `messages` that has any, without its suggested prompts; `null` when none has text. */
function lastReply(messages: unknown): string | null {
	if (!Array.isArray(messages)) return null;
	for (const message of messages.toReversed()) {
		if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const text = message.content
			.flatMap(block => (isObject(block) && block.type === "text" && typeof block.text === "string" && block.text.trim() ? [block.text] : []))
			.join("\n\n");
		if (text) return splitSuggestions(text).body;
	}
	return null;
}

/**
 * What a main-agent live event does to its turn, which both transports report: `agent_start` starts one, and an
 * `agent_end` ends it, unless it hands over to a queued follow-up (`isTerminal: false`); `null` for any other event.
 */
export function turnUpdate(event: unknown): TurnUpdate | null {
	if (!isObject(event)) return null;
	if (event.type === "agent_start") return { kind: "turn-started" };
	return event.type === "agent_end" && event.isTerminal !== false ? { kind: "turn-ended", reply: lastReply(event.messages) } : null;
}

/** A message the session did not take; the session itself reports it, so a caller with someone to tell need not. */
export class PromptRefused extends Error {}

/** A prompt's `catch` for a caller with no one to tell: the session showed a refusal, and anything else still rejects. */
export const skipRefused = (err: unknown): void => {
	if (!(err instanceof PromptRefused)) throw err;
};

export interface LiveSession {
	/** Collab's instance id for a terminal session, a random one for a session this dashboard started. */
	readonly instanceId: string;
	readonly cwd: string;
	readonly sessionId: string;
	/** The roster row of the session as its transport knows it; {@link LiveSessions.rows} adds the rest. */
	row(): LiveRow;
	/**
	 * The file the main agent (`agentId` null) or a subagent writes, or `null` while it is not known.
	 * `savedFile` resolves a session id to its file among the files on disk.
	 */
	transcriptPath(agentId: string | null, savedFile: (sessionId: string) => string | null): string | null;
	/**
	 * Send `text` and `images` to the main agent, or chat `text` to a subagent; `delivery` applies while a turn runs.
	 * Rejects when the text cannot be prepared, and a subagent's message with images, which omp gives no subagent.
	 * Rejects with {@link PromptRefused} when the session does not take the message, which it has already shown its viewers or, for a terminal session closed to the dashboard, need not.
	 */
	prompt(agentId: string | null, text: string, images: PromptImage[], delivery: Delivery): Promise<void>;
	/** Take a queued message back with its images; `null` when the session no longer holds it. */
	dequeue(agentId: string | null, queue: keyof MessageQueue, text: string): Promise<WithdrawnMessage | null>;
	/** Turn a queued follow-up into a steer, which the running turn takes at its next step; whether it was still queued. */
	promote(agentId: string | null, text: string): Promise<boolean>;
	/** Stop the running turn and take back every message waiting on it, oldest steer first, so none runs after the stop. */
	interrupt(): Promise<WithdrawnMessage[]>;
	/**
	 * Stop the running turn only while the session still holds a steer, which omp then runs as its next turn, as an empty
	 * Enter does in omp's terminal. A turn that already took the steer runs on.
	 */
	flush(): void;
	/** Hard-stop a running subagent, as omp's Agent Hub kill does; settles once cancellation is handled, and the session's own turn goes on. */
	cancelAgent(agentId: string): Promise<void>;
	/** Stop the session as closing its terminal would; a terminal session's file stays resumable. */
	end(): Promise<void>;
	/** Reply to one of the session's pending questions; a reply to a question already gone is dropped. */
	answer(requestId: string, answer: UserAnswer): void;
	/** Take the Collab registry's latest listing; a terminal session whose host left it or switched rooms ends. */
	follow(listed: ReadonlyMap<string, HostSnapshot>): void;
	/**
	 * Whether the session should leave the roster at `now`. A terminal session does when its host left the registry, and
	 * when it ended while its host stays listed and waited long enough that the server joins that host again.
	 */
	finished(now: number): boolean;
	/** Let go of the session as the dashboard shuts down. Every session keeps running: the next server joins a terminal one and attaches to one it started. */
	dispose(): Promise<void>;
}
