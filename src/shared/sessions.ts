/** Sessions as the roster, the panes, and the new-session draft see them: live hosts, past sessions, views, requests, and starts. */
import type { BranchChoice } from "./git";
import { type LinkedPullRequest, type PullRequest, samePullRequest } from "./github";
import type { ModelOption } from "./models";

export type HostStatus = "working" | "idle" | "needs-input" | "unknown";

export const AGENT_STATUSES = ["running", "idle", "parked", "aborted"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * How a message sent while a turn runs reaches the agent, as omp's terminal sends it. Enter steers, and omp delivers a
 * `steer` after the current tool call. Ctrl+Enter sends a `followUp`, which omp delivers once the agent finishes its
 * turn. An idle agent takes either as a new prompt.
 */
export type Delivery = "steer" | "followUp";

/**
 * Messages waiting on a running turn, oldest first, in omp's two queues. A dashboard session reports omp's own queues.
 * Collab reports neither, so in a terminal session `steering` stays empty and `followUp` holds what the dashboard
 * keeps back until the turn ends.
 */
export interface MessageQueue {
	steering: string[];
	followUp: string[];
}

export const EMPTY_QUEUE: MessageQueue = { steering: [], followUp: [] };

/** What follows `#` in the page link to a session; the server writes such links into pull request descriptions. */
export const SESSION_HASH_PREFIX = "session/";

export const hashForSession = (sessionId: string): string => `#${SESSION_HASH_PREFIX}${encodeURIComponent(sessionId)}`;

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
	/** Whether the dashboard can message it: a writable terminal room and an agent that is not aborted, or a running subagent of a session this dashboard started. */
	canMessage: boolean;
	queue: MessageQueue;
}

export const SHIP_STAGES = ["ticket", "implement", "draft_pr", "thermonuclear", "ready_gate", "live", "merged"] as const;
export const SHIP_WORK = ["rebase", "fix_comments", "fix_ci"] as const;

export interface ShipProgress {
	stage: (typeof SHIP_STAGES)[number];
	work?: (typeof SHIP_WORK)[number];
	issue?: string;
	pr?: number;
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
	/** What the session and its subagents submitted or worked on; the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents read, changed, opened, or commented on, by identifier; the session's own first. */
	tickets: string[];
	ship: ShipProgress | null;
	/**
	 * The linked git worktree the session works in, when its own bash calls last ran in one of `cwd`'s repository other
	 * than the checkout `cwd` is in; `null` when it works in `cwd`'s checkout.
	 */
	worktree: string | null;
	/** Questions the session waits on, oldest first. */
	requests: UserRequest[];
	/** What waits on the main agent's turn. */
	queue: MessageQueue;
}

export type RosterHost = RosterHostBase &
	(
		| { source: "terminal"; participants: number; relayConnected: boolean }
		/** Started by this dashboard, which can end it. */
		| { source: "dashboard"; thinkingLevels: string[]; switching: boolean; fast: FastMode | null }
	);

/** omp's `/fast` for the session's model: whether you turned it on, and whether requests go out on the priority tier. */
export interface FastMode {
	enabled: boolean;
	active: boolean;
}

/** What the index of session files knows of a session: the pull requests and Linear issues it worked on, its /ship stage, and its worktree. */
export type SessionFacts = Pick<RosterHost, "pullRequests" | "tickets" | "ship" | "worktree">;

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
	/** What the session and its subagents submitted or worked on; the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents read, changed, opened, or commented on, by identifier; the session's own first. */
	tickets: string[];
	ship: ShipProgress | null;
	/** As on {@link RosterHost}. */
	worktree: string | null;
	/** The dashboard started it, and it stopped without **End session**: with the dashboard server, or on its own. */
	interrupted: boolean;
}

/** A saved conversation whose prompts or replies hold every word of a search: `GET /api/conversations?q=`. */
export interface ConversationHit {
	sessionId: string;
	/** The transcript item of its latest message that holds every word, which the page scrolls to. */
	messageId: string;
	role: "user" | "assistant";
	/** That message on one line, cut around the first word searched. */
	snippet: string;
	/** How many of its prompts and replies hold every word. */
	matches: number;
}

export interface ConversationSearchAnswer {
	/** Every match, the session whose file changed last first. */
	hits: ConversationHit[];
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

/** The image types a prompt can carry: the ones every model omp sends images to reads. */
export const PROMPT_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** The most image bytes one prompt carries. The server's socket takes messages big enough for their base64. */
export const MAX_PROMPT_IMAGE_BYTES = 32 * 1024 * 1024;

/** An image sent with a prompt, as omp's `ImageContent` takes it: the file's bytes in base64 and its type. */
export interface PromptImage {
	data: string;
	mimeType: string;
}

/** A queued message taken back before the agent got it, as the composer restores it. */
export interface WithdrawnMessage {
	text: string;
	images: PromptImage[];
}

/** The past list's order: newest first, ties by session id. */
export const newestPastFirst = (a: PastSession, b: PastSession): number => b.modifiedAt - a.modifiedAt || b.sessionId.localeCompare(a.sessionId);

/** One row of a select request. */
export interface RequestOption {
	label: string;
	description: string | null;
}

/**
 * A question a live session waits on: one step of omp's `ask` tool or an extension dialog.
 * omp drives an `ask` as a chain of these. Picking `Other (type your own)` brings a text request,
 * and each pick in a multi-select question brings the same select back with that row checked.
 */
export type UserRequest = {
	id: string;
	title: string;
	/** When omp stops waiting and takes its default, in ms since the epoch; `null` when it waits for good. */
	deadline: number | null;
} & (
	/** `checked`: rows a multi-select question has ticked so far; omp's RPC frames never report them. */
	| { kind: "select"; options: RequestOption[]; checked: number[] }
	| { kind: "confirm"; message: string }
	| { kind: "text"; multiline: boolean; placeholder: string | null; prefill: string }
);

/** A reply to a {@link UserRequest}: a row label or typed text, a yes or no, or a dismissal. */
export type UserAnswer = { kind: "value"; value: string } | { kind: "confirm"; confirmed: boolean } | { kind: "cancel" };

/**
 * Whether the dashboard can prompt and stop the session right now. Transcripts are read from disk
 * and never wait on it. Terminal sessions go through a Collab room; dashboard sessions are always live.
 */
export type ControlPhase =
	| { phase: "connecting" }
	| { phase: "live"; readOnly: boolean }
	| { phase: "reconnecting"; reason: string }
	| { phase: "ended"; reason: string };

/** What a session started from a quick action works on: a pull request, or a Linear issue by its identifier. */
export type WorkItem = { kind: "pull-request"; pr: PullRequest } | { kind: "ticket"; id: string };

/** Whether `links`, a session's pull requests and Linear issues, name `item`. */
export const worksOn = (links: Pick<RosterHost, "pullRequests" | "tickets">, item: WorkItem): boolean =>
	item.kind === "ticket" ? links.tickets.includes(item.id) : links.pullRequests.some(pr => samePullRequest(pr, item.pr));

/**
 * What a `start` asks for: a new session in `cwd` (absolute, or starting with `~`) that takes `prompt` and `images` as
 * its first message, on `branch` when it names one, else in `cwd` as it is, on `model` when it names one, else on omp's
 * default, at thinking level `thinking` when it names one, through skill `skill`, the one pinned in the settings,
 * when it names one, and linked to `subject` from its start, before its tool calls name it; a fork holding the view's
 * history before the user prompt `entryId`, its file left untouched; or past session `sessionId` continued in its own
 * file, as `omp --resume` does.
 */
export type StartRequest =
	| {
			kind: "new";
			cwd: string;
			prompt: string;
			images: PromptImage[];
			branch: BranchChoice | null;
			model: ModelOption | null;
			thinking: string | null;
			skill: string | null;
			subject: WorkItem | null;
			/** The todo the session works on, which links to it once omp starts; `null` for none. */
			todoId: string | null;
	  }
	| { kind: "fork"; view: View; entryId: string }
	| { kind: "resume"; sessionId: string };
/** A `start` of a new session. */
export type NewSessionRequest = Extract<StartRequest, { kind: "new" }>;
/** A new session in `cwd` on `prompt`, with no images, branch, model, thinking level, skill, subject, or todo but those `options` name. */
export const newSessionRequest = (cwd: string, prompt: string, options: Partial<Omit<NewSessionRequest, "kind" | "cwd" | "prompt">> = {}): NewSessionRequest => ({
	kind: "new",
	cwd,
	prompt,
	images: [],
	branch: null,
	model: null,
	thinking: null,
	skill: null,
	subject: null,
	todoId: null,
	...options,
});
/** `GET /api/skills?cwd=<dir>`: one skill a session started in that directory can invoke as `/skill:<name>`. */
export interface SkillOption {
	name: string;
	description: string | null;
}
/** `cwd` is the absolute directory the session runs in. `prompt` is the text of the prompt a fork branched at, for the composer; `null` for the other kinds. */
export type StartResult = { ok: true; instanceId: string; cwd: string; prompt: string | null } | { ok: false; error: string };
/** Where `/` and `@` resolve: an open live view's session, or the directory the new-session draft will start omp in. */
export type CompletionScope = { kind: "live"; view: LiveView } | { kind: "new"; cwd: string };
/** One `/` or `@` suggestion, with the composer text and caret it produces when accepted (omp's own insertion). */
export interface CompletionItem {
	kind: "command" | "skill" | "file" | "directory";
	label: string;
	description: string | null;
	text: string;
	cursor: number;
}
