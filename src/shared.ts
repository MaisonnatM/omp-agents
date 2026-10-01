/** Messages and view models shared by the server and the page. */

export type HostStatus = "working" | "idle" | "needs-input" | "unknown";

export type AgentStatus = "running" | "idle" | "parked" | "aborted";

/** A subagent of a session. The main agent is the session itself and is not listed. */
export interface AgentRow {
	id: string;
	/** Agent type, e.g. `task` or `explore`. */
	kind: string;
	/** Parent subagent id; `null` when the session's main agent spawned it. */
	parentId: string | null;
	status: AgentStatus;
	/** What it is doing now, or else its task, as one line. */
	activity: string | null;
	/** Whether the dashboard can message it: a writable terminal room and an agent that is not aborted. */
	canMessage: boolean;
}

interface RosterHostBase {
	/** Collab instance id for terminal sessions, a dashboard-assigned id for dashboard sessions. Stable across `/new`. */
	instanceId: string;
	pid: number;
	sessionId: string;
	sessionName: string | null;
	cwd: string;
	/** `cwd` with the home directory shortened to `~`. */
	cwdDisplay: string;
	model: string | null;
	/** omp's thinking level (`off`, `low`, … `xhigh`), or `null` before the session reports one. */
	thinkingLevel: string | null;
	/** How full the context window is, or `null` before the session reports it. */
	context: ContextUsage | null;
	startedAt: number;
	status: HostStatus;
	control: ControlPhase;
	agents: AgentRow[];
}

export type RosterHost = RosterHostBase &
	(
		| { source: "terminal"; participants: number; relayConnected: boolean }
		/** Started by this dashboard, which can end it. */
		| { source: "dashboard"; thinkingLevels: string[] }
	);

/** Context-window occupancy as omp's status line counts it. */
export interface ContextUsage {
	tokens: number;
	window: number;
}

/** A session that has no live host, read from its file on disk. */
export interface PastSession {
	sessionId: string;
	/** Its title, else its first prompt as one line; `null` when it has neither. */
	title: string | null;
	cwd: string;
	cwdDisplay: string;
	/** Last write to the session file, in ms since the epoch. */
	modifiedAt: number;
}

export interface LiveView {
	kind: "live";
	instanceId: string;
	agentId: string | null;
}

export interface PastView {
	kind: "past";
	sessionId: string;
}

/** What the conversation pane shows: a live session or one of its subagents, or a past session's saved transcript. */
export type View = LiveView | PastView;

export type Item =
	/** `entryId`: the session-file entry omp can branch at; `null` for Collab prompts and prompts not yet in the file. */
	| { id: string; kind: "user"; text: string; from: string | null; entryId: string | null }
	| { id: string; kind: "assistant"; text: string; streaming: boolean }
	| { id: string; kind: "tool"; name: string; summary: string; status: "running" | "ok" | "error" }
	| { id: string; kind: "notice"; level: "info" | "warning" | "error"; text: string };

/**
 * Whether the dashboard can prompt and stop the session right now. Transcripts are read from disk
 * and never wait on it. Terminal sessions go through a Collab room; dashboard sessions are always live.
 */
export type ControlPhase =
	| { phase: "connecting" }
	| { phase: "live"; readOnly: boolean }
	| { phase: "reconnecting"; reason: string }
	| { phase: "ended"; reason: string };

export type LaunchResult = { ok: true; instanceId: string } | { ok: false; error: string };
/** `prompt` is the text of the prompt forked at, for the composer. */
export type ForkResult = { ok: true; instanceId: string; prompt: string } | { ok: false; error: string };
/** One `/` or `@` suggestion, with the composer text and caret it produces when accepted (omp's own insertion). */
export interface CompletionItem {
	kind: "command" | "skill" | "file" | "directory";
	label: string;
	description: string | null;
	text: string;
	cursor: number;
}

/** One `/` or `@` suggestion, with the composer text and caret it produces when accepted (omp's own insertion). */
export interface CompletionItem {
	kind: "command" | "skill" | "file" | "directory";
	label: string;
	description: string | null;
	text: string;
	cursor: number;
}

/** One quota window of a provider plan. */
export interface PlanWindow {
	/** Short name: the window id (`5h`, `7d`, `monthly`) plus its model tier, else omp's label when that is ambiguous. */
	label: string;
	/** omp's name for the limit, e.g. `Claude 7 Day (Fable)`. */
	title: string;
	/** Fraction of the window's quota left, 0 to 1. */
	remaining: number;
	resetsAt: number | null;
}

/** A provider account that `omp usage` reports plan limits for. */
export interface PlanUsage {
	provider: string;
	name: string;
	account: string | null;
	windows: PlanWindow[];
}

/** A model a session can switch to; `provider/id` is omp's model selector. */
export interface ModelOption {
	provider: string;
	id: string;
}

export type ServerMsg =
	| { t: "hello"; ompVersion: string }
	| { t: "roster"; hosts: RosterHost[]; error: string | null }
	/** Newest first. */
	| { t: "past"; sessions: PastSession[] }
	/** `reset` replaces the view's transcript; otherwise `items` are upserts by id, new ids appended. */
	| { t: "items"; view: View; reset: boolean; items: Item[] }
	/** Answers this socket's `create` once the new session is ready, or once it failed to start. */
	| { t: "created"; result: LaunchResult }
	/** Answers this socket's `fork` once the forked session is ready, or once forking failed. */
	| { t: "forked"; result: ForkResult }
	| { t: "completions"; reqId: number; items: CompletionItem[]; error: string | null }
	/** Plans as of the last `omp usage` run. `error` is set, and `plans` empty, when that run failed. */
	| { t: "usage"; plans: PlanUsage[]; error: string | null }
	/** Answers `list-models`. `error` is set when the session cannot list or switch models. */
	| { t: "models"; instanceId: string; models: ModelOption[]; error: string | null };

export type ClientMsg =
	| { t: "watch"; view: View | null }
	/** A prompt to the session, or chat to the subagent (steer if running, prompt if idle, revive if parked). */
	| { t: "prompt"; view: LiveView; text: string }
	| { t: "abort"; instanceId: string }
	/** Suggestions for the composer text with the caret at `cursor`, resolved against the view's session cwd. */
	| { t: "complete"; reqId: number; view: LiveView; text: string; cursor: number }
	/** Start a new omp session in `cwd` (absolute, or starting with `~`). */
	| { t: "create"; cwd: string }
	/** End a session this dashboard started. */
	| { t: "end"; instanceId: string }
	/** Start a dashboard session holding the view's history before the user prompt `entryId`. The view's file stays untouched. */
	| { t: "fork"; view: View; entryId: string }
	/** Models a session this dashboard started can switch to. */
	| { t: "list-models"; instanceId: string }
	/** Switch a session this dashboard started to another model. */
	| { t: "set-model"; instanceId: string; model: ModelOption }
	/** Switch a session this dashboard started to another thinking level, one of its `thinkingLevels`. */
	| { t: "set-thinking"; instanceId: string; level: string }
	/** Suggestions for the composer text with the caret at `cursor`, resolved against the view's session cwd. */
	| { t: "complete"; reqId: number; view: LiveView; text: string; cursor: number };
