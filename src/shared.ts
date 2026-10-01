/** Messages and view models shared by the server and the page. */

export type HostStatus = "working" | "idle" | "needs-input" | "unknown";

export type Access = "view" | "control";

export type AgentStatus = "running" | "idle" | "parked" | "aborted";

/** A subagent of a session, from the host's agent registry. The main agent is the session itself and is not listed. */
export interface AgentRow {
	id: string;
	/** Agent type, e.g. `task` or `explore`. */
	kind: string;
	/** Parent subagent id; `null` when the session's main agent spawned it. */
	parentId: string | null;
	status: AgentStatus;
	/** What it is doing now, or else its task, as one line. */
	activity: string | null;
	/** Whether `agent-cmd` chat can reach it: a writable room and an agent that is not aborted. */
	canMessage: boolean;
}

export interface RosterHost {
	instanceId: string;
	generation: number;
	pid: number;
	sessionId: string;
	sessionName: string | null;
	cwd: string;
	/** `cwd` with the home directory shortened to `~`. */
	cwdDisplay: string;
	model: string | null;
	startedAt: number;
	participants: number;
	relayConnected: boolean;
	status: HostStatus;
	access: Access;
	agents: AgentRow[];
}

/** What the conversation pane shows: a session, or one of its subagents. */
export interface View {
	instanceId: string;
	agentId: string | null;
}

export type Item =
	| { id: string; kind: "user"; text: string; from: string | null }
	| { id: string; kind: "assistant"; text: string; streaming: boolean }
	| { id: string; kind: "tool"; name: string; summary: string; status: "running" | "ok" | "error" }
	| { id: string; kind: "notice"; level: "info" | "warning" | "error"; text: string };

export type GuestPhase =
	| { phase: "connecting" }
	| { phase: "syncing" }
	| { phase: "live"; readOnly: boolean }
	| { phase: "reconnecting"; reason: string }
	| { phase: "ended"; reason: string };

export type ServerMsg =
	| { t: "hello"; ompVersion: string }
	| { t: "roster"; hosts: RosterHost[]; error: string | null }
	/** Connection state of the server's guest in a session's room. Subagent views share it. */
	| { t: "phase"; instanceId: string; phase: GuestPhase }
	/** `reset` replaces the view's transcript; otherwise `items` are upserts by id, new ids appended. */
	| { t: "items"; view: View; reset: boolean; items: Item[] };

export type ClientMsg =
	| { t: "watch"; view: View | null }
	/** A prompt to the session, or chat to the subagent (steer if running, prompt if idle, revive if parked). */
	| { t: "prompt"; view: View; text: string }
	| { t: "abort"; instanceId: string };
