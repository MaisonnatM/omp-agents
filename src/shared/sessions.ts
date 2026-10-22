/** Sessions as the roster, the panes, and the new-session draft see them: live hosts, past sessions, views, requests, and starts. */
import { BASE64, isNonEmpty, isObject, type Parsed } from "../json";
import { isTodoId } from "../user-todos-parse";
import type { BranchChoice } from "./git";
import { type LinkedPullRequest, parsePullRequest, type PullRequest, samePullRequest } from "./github";
import type { ModelOption } from "./models";
import type { ReplayFacts } from "./replay";
import { TICKET_ID } from "./tickets";

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

/** A branch a session works on. */
export interface SessionBranch {
	name: string;
	/** Whether it is checked out in a linked worktree, which copying it can free; otherwise in the repository's main checkout. */
	linked: boolean;
	/** The repository's default branch, as `origin/HEAD` names it, which a pull request from this branch merges into; `null` when git has not recorded one. */
	defaultBranch: string | null;
	/** The pull request this branch heads, open or merged, as the pull request list says or GitHub answered when the session named a new PR; `null` while neither names one. */
	pullRequest: PullRequest | null;
}

/** What the index of session files knows of a session: the pull requests and Linear issues it worked on, its /ship stage, its worktree, and its branch. */
export interface SessionFacts {
	/** What the session and its subagents submitted or worked on; the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents read, changed, opened, or commented on, by identifier; the session's own first. */
	tickets: string[];
	ship: ShipProgress | null;
	/**
	 * The linked git worktree the session works in, when its own bash calls last ran in one of its working directory's repository other
	 * than the checkout its working directory is in; `null` when it works in that checkout.
	 */
	worktree: string | null;
	/**
	 * The branch the session works on in its `worktree`, else its `cwd`: the one checked out now in a linked worktree, or in a main
	 * checkout the one checked out when the session last wrote; `null` on a detached HEAD, outside git, or once that directory is gone.
	 */
	branch: SessionBranch | null;
	replay?: ReplayFacts;
}

interface RosterHostBase extends SessionFacts {
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
	/** Questions the session waits on, oldest first. */
	requests: UserRequest[];
	/** What waits on the main agent's turn. */
	queue: MessageQueue;
	/** The main agent's turn that ended since you last looked at the session; `null` once you did, or while a turn runs. */
	unread: UnreadTurn | null;
}

/** A turn that ended unseen: when, in ms since the epoch, and the first line of its reply, `null` when it ended on none. */
export interface UnreadTurn {
	at: number;
	reply: string | null;
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

/** Context-window occupancy as omp's status line counts it. */
export interface ContextUsage {
	tokens: number;
	window: number;
}

/** The agent that wrote a session file: omp, or Claude Code and Codex, whose sessions the dashboard only reads. */
export const SESSION_SOURCES = ["omp", "claude-code", "codex"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/** A session that has no live host, read from its file on disk. */
export interface PastSession extends SessionFacts {
	sessionId: string;
	/** Its title, else its first prompt as one line; `null` when it has neither. */
	title: string | null;
	cwd: string;
	/** Only an omp session resumes or forks; the others are read-only. */
	source: SessionSource;
	cwdDisplay: string;
	/** Last write to the session file, in ms since the epoch. */
	modifiedAt: number;
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

/** One question of an `ask` request. */
export interface AskQuestion {
	id: string;
	question: string;
	header: string | null;
	options: RequestOption[];
	multi: boolean;
	/** The row omp suggests, by index. */
	recommended: number | null;
}

/** The answer to one {@link AskQuestion}: the picked rows' labels, and the typed text when the user wrote their own. */
export interface AskReply {
	id: string;
	selected: string[];
	custom: string | null;
}

/**
 * A question a live session waits on: omp's `ask` tool or an extension dialog. A dashboard session gets each `ask` call
 * whole, as one `ask` request. A terminal session gets it as a chain of the others: picking `Other (type your own)` brings
 * a text request, and each pick in a multi-select question brings the same select back with that row checked.
 */
export type UserRequest = {
	id: string;
	title: string;
	/** When omp stops waiting and takes its default, in ms since the epoch; `null` when it waits for good. */
	deadline: number | null;
} & (
	/** `checked`: rows a multi-select question has ticked so far. */
	| { kind: "select"; options: RequestOption[]; checked: number[] }
	| { kind: "confirm"; message: string }
	| { kind: "text"; multiline: boolean; placeholder: string | null; prefill: string }
	| { kind: "ask"; questions: AskQuestion[] }
);

/** A reply to a {@link UserRequest}: a row label or typed text, a yes or no, every `ask` answer in question order, or a dismissal. */
export type UserAnswer =
	| { kind: "value"; value: string }
	| { kind: "confirm"; confirmed: boolean }
	| { kind: "ask"; answers: AskReply[] }
	| { kind: "cancel" };

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
			/** The session reviews `subject`, a pull request, as a review draft it saves through the dashboard's `save_review_draft` tool rather than posting on GitHub. */
			reviewDraft: boolean;
	  }
	| { kind: "fork"; view: View; entryId: string }
	| { kind: "replay"; view: View; token: string; model: ModelOption | null; thinking: string | null; prompt: string | null }
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
	reviewDraft: false,
	...options,
});

/** The longest base64 of {@link MAX_PROMPT_IMAGE_BYTES}. */
const MAX_PROMPT_IMAGE_BASE64 = Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4;

/** A prompt's images: `[]` when it sends none, `null` for anything but images of {@link PROMPT_IMAGE_TYPES} within the size limit. */
export function parseImages(value: unknown): Parsed<PromptImage[]> {
	if (value === undefined) return { ok: [] };
	if (!Array.isArray(value)) return null;
	const images: PromptImage[] = [];
	let size = 0;
	for (const image of value) {
		if (!isObject(image) || typeof image.data !== "string" || typeof image.mimeType !== "string") return null;
		if (!PROMPT_IMAGE_TYPES.includes(image.mimeType) || !BASE64.test(image.data)) return null;
		size += image.data.length;
		images.push({ data: image.data, mimeType: image.mimeType });
	}
	return size <= MAX_PROMPT_IMAGE_BASE64 ? { ok: images } : null;
}

export function parseModel(value: unknown): Parsed<ModelOption> {
	return isObject(value) && isNonEmpty(value.provider) && isNonEmpty(value.id) ? { ok: { provider: value.provider, id: value.id } } : null;
}

/** `{ ok: null }` for none, which keeps omp's thinking level. */
export function parseThinking(value: unknown): Parsed<string | null> {
	if (value === null || value === undefined) return { ok: null };
	return isNonEmpty(value) ? { ok: value } : null;
}

/** `{ ok: null }` for no pinned skill; only one token passes, as `/skill:<name>` takes a name. */
export function parseSkill(value: unknown): Parsed<string | null> {
	if (value === null || value === undefined) return { ok: null };
	return typeof value === "string" && /^\S+$/.test(value) ? { ok: value } : null;
}

/** `{ ok: null }` for no branch. */
export function parseBranchChoice(value: unknown): Parsed<BranchChoice | null> {
	if (value === null || value === undefined) return { ok: null };
	if (!isObject(value) || !isNonEmpty(value.name)) return null;
	if (value.kind === "existing") return { ok: { kind: "existing", name: value.name } };
	return value.kind === "new" && isNonEmpty(value.base) ? { ok: { kind: "new", name: value.name, base: value.base } } : null;
}

/** `{ ok: null }` for a start that works on nothing in particular. */
function parseWorkItem(value: unknown): Parsed<WorkItem | null> {
	if (value === null || value === undefined) return { ok: null };
	if (!isObject(value)) return null;
	if (value.kind === "ticket") return typeof value.id === "string" && TICKET_ID.test(value.id) ? { ok: { kind: "ticket", id: value.id } } : null;
	if (value.kind !== "pull-request" || !isObject(value.pr)) return null;
	const pr = parsePullRequest(value.pr.owner, value.pr.repo, value.pr.number);
	return pr && { ok: { kind: "pull-request", pr: pr.ok } };
}

/**
 * A new session's start, as the socket's `start` carries one and `scheduled.json` keeps one: `null` without a `cwd`, without
 * a prompt or an image, or when an option is of the wrong type; options left out take {@link newSessionRequest}'s defaults.
 */
export function parseNewSessionRequest(value: unknown): Parsed<NewSessionRequest> {
	if (!isObject(value) || value.kind !== "new") return null;
	const { cwd, prompt, todoId = null, reviewDraft = false } = value;
	const images = parseImages(value.images);
	const branch = parseBranchChoice(value.branch);
	// `null` starts on omp's default model.
	const model = value.model === null || value.model === undefined ? { ok: null } : parseModel(value.model);
	const thinking = parseThinking(value.thinking);
	const skill = parseSkill(value.skill);
	const subject = parseWorkItem(value.subject);
	if (!isNonEmpty(cwd) || typeof prompt !== "string" || !images || !branch || !model || !thinking || !skill || !subject) return null;
	if (todoId !== null && !isTodoId(todoId)) return null;
	// Only a pull request has a review draft.
	if (typeof reviewDraft !== "boolean" || (reviewDraft && subject.ok?.kind !== "pull-request")) return null;
	return prompt.trim() || images.ok.length > 0
		? { ok: newSessionRequest(cwd, prompt, { images: images.ok, branch: branch.ok, model: model.ok, thinking: thinking.ok, skill: skill.ok, subject: subject.ok, todoId, reviewDraft }) }
		: null;
}

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
