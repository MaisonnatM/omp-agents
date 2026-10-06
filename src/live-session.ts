/** What the server asks of a running session, whether it is a terminal session it joined or one it started itself. */
import type { HostSnapshot } from "./omp/collab";
import type { Delivery, MessageQueue, PromptImage, RosterHost, UserAnswer } from "./shared";

/** What the index of session files knows of a session: the pull requests and Linear issues it worked on, and its /ship stage. */
export type SessionFacts = Pick<RosterHost, "pullRequests" | "tickets" | "ship">;

type WithoutKeys<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A roster row before the server adds the session's `cwdDisplay` and its {@link SessionFacts}. */
export type LiveRow = WithoutKeys<RosterHost, "cwdDisplay" | keyof SessionFacts>;

/** What a live session reports as it runs. */
export type LiveUpdate =
	/** Its roster row changed: control phase, subagents, or what a subagent is doing. */
	| { kind: "roster" }
	/** A live agent event of the session; it streams what the session file does not hold yet. */
	| { kind: "event"; event: unknown }
	/** An out-of-band line for the session (`agentId` null) or one of its subagents. */
	| { kind: "note"; agentId: string | null; level: "info" | "warning" | "error"; text: string };

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
	 */
	prompt(agentId: string | null, text: string, images: PromptImage[], delivery: Delivery): Promise<void>;
	/** Take a queued message back; whether the session still held it. */
	dequeue(agentId: string | null, queue: keyof MessageQueue, text: string): Promise<boolean>;
	abort(): void;
	/**
	 * Stop the running turn only while the session still holds a steer, which omp then runs as its next turn, as an empty
	 * Enter does in omp's terminal. A turn that already took the steer runs on.
	 */
	flush(): void;
	/** Hard-stop a running subagent, as omp's Agent Hub kill does; the session's own turn goes on. */
	cancelAgent(agentId: string): void;
	/** Stop the session as closing its terminal would; a terminal session's file stays resumable. */
	end(): Promise<void>;
	/** Reply to one of the session's pending questions; a reply to a question already gone is dropped. */
	answer(requestId: string, answer: UserAnswer): void;
	/** Follow the Collab registry's latest listing. `false` once the session should leave the roster. */
	follow(listed: ReadonlyMap<string, HostSnapshot>): boolean;
	/** Let go of the session as the dashboard shuts down: a terminal session keeps running, one this dashboard started stops. */
	dispose(): Promise<void>;
}
