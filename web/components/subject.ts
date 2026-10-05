import type { AgentRow, ControlPhase, LiveView, MessageQueue, RosterHost, UserRequest } from "../../src/shared";
import type { ShellReach } from "./composer";

const SESSION_GONE: ControlPhase = { phase: "ended", reason: "This session is no longer running." };
const SUBAGENT_GONE: ControlPhase = { phase: "ended", reason: "This subagent is no longer registered." };

interface Facts {
	/** Current roster row, or `null` once the session has left the roster. */
	host: RosterHost | null;
	/** The current row, else the last known one, for the header after the session ended. */
	shown: RosterHost | null;
	/** The subagent's row, or `null` for the session itself and for a subagent that is no longer registered. */
	agent: AgentRow | null;
	phase: ControlPhase;
	/** The connection can send. */
	live: boolean;
	/** The composer takes a message. */
	writable: boolean;
	/** The composer takes images; omp sends a subagent text only. */
	attachable: boolean;
	working: boolean;
	/** What waits on the running turn, or `undefined` while there is no row. */
	queue: MessageQueue | undefined;
	/** Questions the subject waits on. They belong to the session's main agent, and only a writer can answer them. */
	requests: UserRequest[];
	/** A follow-up could be held until the turn ends. omp's RPC mode reaches only a running subagent, so nothing could send one held until it stopped. */
	followUps: boolean;
	shell: ShellReach;
}

/** What a conversation's composer talks to: the session itself, or one of its subagents. */
export type Subject =
	| (Facts & {
			kind: "session";
			/** Collab rooms carry no model or thinking switch, so only a session this dashboard started over RPC can change them. */
			switchable: Extract<RosterHost, { source: "dashboard" }> | null;
	  })
	| (Facts & { kind: "subagent" });

/** The one place that tells a session from a subagent: `view` against the roster row and the last one seen. */
export function subjectOf(view: LiveView, host: RosterHost | null, lastHost: RosterHost | null): Subject {
	const shown = host ?? lastHost;
	if (view.agentId === null) {
		const phase = host ? host.control : SESSION_GONE;
		const live = phase.phase === "live" && !phase.readOnly;
		return {
			kind: "session",
			host,
			shown,
			agent: null,
			phase,
			live,
			writable: live,
			attachable: live,
			working: host?.status === "working",
			queue: host?.queue,
			requests: live && host ? host.requests : [],
			followUps: true,
			shell: host?.source === "dashboard" ? "rpc" : "none",
			switchable: host?.source === "dashboard" && live ? host : null,
		};
	}
	const agent = shown?.agents.find(row => row.id === view.agentId) ?? null;
	const phase = !host ? SESSION_GONE : !agent ? SUBAGENT_GONE : host.control;
	const live = phase.phase === "live" && !phase.readOnly;
	return {
		kind: "subagent",
		host,
		shown,
		agent,
		phase,
		live,
		writable: live && agent?.canMessage === true,
		attachable: false,
		working: agent?.status === "running",
		queue: agent?.queue,
		requests: [],
		followUps: !(agent && host?.source === "dashboard"),
		shell: "none",
	};
}
