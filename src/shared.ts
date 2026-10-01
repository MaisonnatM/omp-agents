/** Messages and view models shared by the server and the page. */

export type HostStatus = "working" | "idle" | "needs-input" | "unknown";

export type Access = "view" | "control";

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
	| { t: "phase"; instanceId: string; phase: GuestPhase }
	/** `reset` replaces the whole transcript; otherwise `items` are upserts by id, new ids appended. */
	| { t: "items"; instanceId: string; reset: boolean; items: Item[] };

export type ClientMsg =
	| { t: "watch"; instanceId: string | null }
	| { t: "prompt"; instanceId: string; text: string }
	| { t: "abort"; instanceId: string };
