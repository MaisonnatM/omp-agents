/** Messages and view models shared by the server and the page. */

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

/** A GitHub repository. */
export interface Repo {
	owner: string;
	repo: string;
}

/** A GitHub pull request. */
export interface PullRequest extends Repo {
	number: number;
}

/** A GitHub repository's key in maps and lookups: `owner/repo`, lowercased, since GitHub matches names in any case. */
export const repoKey = ({ owner, repo }: Repo): string => `${owner}/${repo}`.toLowerCase();

/** A pull request's key: `owner/repo#number`, lowercased. */
export const prKey = (pr: PullRequest): string => `${repoKey(pr)}#${pr.number}`;

/** A branch's key: `owner/repo:branch`, the repository lowercased and the branch, which git keeps case-sensitive, as is. */
export const headKey = (repo: Repo, branch: string): string => `${repoKey(repo)}:${branch}`;

export const samePullRequest = (a: PullRequest, b: PullRequest): boolean => prKey(a) === prKey(b);

/** What follows `#` in the page link to a session; the server writes such links into pull request descriptions. */
export const SESSION_HASH_PREFIX = "session/";

export const hashForSession = (sessionId: string): string => `#${SESSION_HASH_PREFIX}${encodeURIComponent(sessionId)}`;

/** The window event the desktop shell's quick-capture shortcut dispatches; the page opens the Todo page with a new todo started. */
export const QUICK_TODO_EVENT = "omp-quick-todo";

/**
 * How a session's tool calls touched a pull request: it submitted it with `gt submit` or `gh pr create`, or it
 * worked on it with `gh pr checkout`, `edit`, `comment`, `review`, `merge`, or `ready`, a `git push` to its branch,
 * or an omp `pr://` read.
 */
export type PullRequestLink = "submitted" | "worked";

export interface LinkedPullRequest extends PullRequest {
	link: PullRequestLink;
}

/** Where the viewer stands on a pull request in the inbox: they wrote it, or someone asked them to review it. */
export type InboxRole = "author" | "reviewer";

/** GitHub's review decision, plus `none` for a repository that requires no review. */
export type ReviewDecision = "approved" | "changes-requested" | "review-required" | "none";

/** The rollup of the head commit's checks. */
export type CheckState = "passing" | "failing" | "pending" | "none";

/** A GitHub user, bot, or team; `avatarUrl` is `null` when GitHub reports none. */
export interface Person {
	login: string;
	avatarUrl: string | null;
}

/** Where one reviewer stands: their latest review, or `requested` while a review from them is pending. */
export type ReviewerState = "approved" | "changes-requested" | "commented" | "requested";

export interface Reviewer extends Person {
	state: ReviewerState;
}

/** A pull request on the inbox page, as GitHub reports it now. */
export interface InboxPullRequest extends PullRequest {
	title: string;
	author: Person;
	/** Requested reviewers first, then the others in GitHub's order of their latest reviews. */
	reviewers: Reviewer[];
	role: InboxRole;
	state: "open" | "draft" | "merged";
	review: ReviewDecision;
	checks: CheckState;
	/** True when GitHub reports the PR as `CONFLICTING` with its base branch; false for `MERGEABLE`, `UNKNOWN` (not computed yet), and merged PRs. */
	conflicts: boolean;
	head: string;
	/** The branch it merges into when that is not the repository's default branch: the PR below it in a stack. */
	stackedOn: string | null;
	/** Review threads not yet resolved. `exact` is false when GitHub listed only some threads, so `count` is a floor. */
	unresolved: { count: number; exact: boolean };
	/** Last update, or the merge for a merged PR, in ms since the epoch. */
	updatedAt: number;
}

/** One GitHub repository's inbox, for the workspaces whose `origin` it is. */
export type RepoInbox = Repo & { cwds: string[] } & ({ pullRequests: InboxPullRequest[] } | { error: string });

export interface Inbox {
	repos: RepoInbox[];
	/** Workspaces with no GitHub `origin`, which the inbox cannot show. */
	unmatched: string[];
}

/** Linear's workflow state categories, in the order its My issues lists them. */
export const TICKET_STATUS_TYPES = ["triage", "started", "unstarted", "backlog", "completed", "canceled"] as const;
export type TicketStatusType = (typeof TICKET_STATUS_TYPES)[number];

/** Linear's priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const TICKET_PRIORITIES = [0, 1, 2, 3, 4] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** A Linear issue assigned to the viewer, on the tickets page. */
export interface Ticket {
	/** The identifier Linear shows: `ENG-2368`. */
	id: string;
	title: string;
	url: string;
	/** The workflow state's name: `In Review`. */
	status: string;
	statusType: TicketStatusType;
	priority: TicketPriority;
	labels: string[];
	project: string | null;
	team: string;
	/** `YYYY-MM-DD`. */
	dueDate: string | null;
	/** ISO time. */
	updatedAt: string;
	/** Linear's suggested git branch name. */
	branch: string;
}

/** `GET /api/tickets`: the viewer's assigned Linear issues. A failed read is the API's usual `{ error }` with status 500. */
export interface TicketsAnswer {
	tickets: Ticket[];
}

/** A sign-in to Linear that the settings started: waiting for the browser at Linear's authorization `url`, or why it failed. */
export type LinearSignIn = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** `GET /api/linear`, and `PUT /api/linear/sign-in`, which starts a sign-in. */
export interface LinearStatus {
	/** omp has an MCP server for Linear and a sign-in for it, so the tickets page can read the issues. */
	connected: boolean;
	/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
	signIn: LinearSignIn;
}

/** A Linear issue's identifier as Linear shows it, `ENG-2368`: its team's key, a dash, and its number. */
export const TICKET_ID = /^[A-Z][A-Z0-9_]*-\d+$/;

/** Where the page loads a file that a Linear issue or its comments embed; the server fetches it from Linear. */
export const TICKET_MEDIA_PATH = "/api/ticket/media";

/** One of the things an issue's pickers offer: a person, a project, or a workflow state. */
export interface TicketChoice {
	id: string;
	name: string;
}

/** `PUT /api/ticket/new`: a Linear issue to open in team `team`, Linear's id of it, assigned to the viewer. It answers the new issue's identifier. */
export interface TicketDraft {
	title: string;
	description: string;
	team: string;
}

export interface TicketComment {
	author: string;
	/** Markdown. */
	body: string;
	/** ISO time. */
	createdAt: string;
}

/** `GET /api/ticket?id=<identifier>`: a Linear issue in full, for the tickets page's main content. */
export interface TicketDetail extends Ticket {
	/** Markdown, with Linear's issue mentions as links, and its images and videos loading through `TICKET_MEDIA_PATH`. */
	description: string;
	createdBy: string | null;
	/** ISO time. */
	createdAt: string;
	assignee: TicketChoice | null;
	/** Linear's id of the issue's team, whose states, labels, and projects the pickers offer. */
	teamId: string;
	/** What Linear links the issue to: pull requests, documents, and other pages. */
	attachments: { title: string; url: string }[];
	/** Comment threads, oldest first, each its first comment then the replies. */
	threads: TicketComment[][];
}

/** `GET /api/ticket/options?team=<id>`: what the issue's field pickers offer for that team. */
export interface TicketOptions {
	/** In Linear's workflow order: triage, backlog, unstarted, started, completed, canceled. */
	statuses: (TicketChoice & { type: TicketStatusType })[];
	/** Active members, by name. */
	users: TicketChoice[];
	/** The team's labels and the workspace's, by name. */
	labels: (TicketChoice & { color: string })[];
	projects: TicketChoice[];
}

/**
 * `PUT /api/ticket`: changes to an issue, each field left out unchanged and `null` clearing it, which answers the
 * issue as Linear has it after the change. `state`, `assignee`, and `project` are ids; `labels` replaces every label,
 * by name; `dueDate` is `YYYY-MM-DD`.
 */
export interface TicketEdit {
	id: string;
	state?: string;
	assignee?: string | null;
	priority?: TicketPriority;
	labels?: string[];
	project?: string | null;
	dueDate?: string | null;
}

/** How one check on a pull request's head commit went; `skipped` covers neutral and skipped runs. */
export type CheckRunState = "passing" | "failing" | "pending" | "skipped";

export interface PullRequestCheck {
	name: string;
	state: CheckRunState;
	url: string | null;
}

export interface PullRequestFile {
	path: string;
	additions: number;
	deletions: number;
	change: "added" | "deleted" | "modified" | "renamed" | "copied" | "changed";
}

export interface PullRequestComment {
	author: Person;
	/** Markdown, as written on GitHub. */
	body: string;
	/** When it was posted, in ms since the epoch. */
	at: number;
	url: string | null;
}

/** A comment on the pull request, or a submitted review, which may carry no text when it only approves or asks for changes. */
export interface PullRequestEvent extends PullRequestComment {
	/** `null` for a plain comment. */
	review: "approved" | "changes-requested" | "commented" | "dismissed" | null;
}

/** An unresolved review thread on a line of a file; `line` is `null` once the line no longer exists in the diff. */
export interface PullRequestThread {
	path: string;
	line: number | null;
	comments: PullRequestComment[];
}

/** One pull request in full, as the inbox's sheet shows it in place of opening GitHub. */
export interface PullRequestDetail extends PullRequest {
	title: string;
	body: string;
	author: Person;
	reviewers: Reviewer[];
	state: "open" | "draft" | "merged" | "closed";
	review: ReviewDecision;
	head: string;
	base: string;
	/** True when GitHub reports the PR as `CONFLICTING` with its base branch, as on {@link InboxPullRequest}. */
	conflicts: boolean;
	additions: number;
	deletions: number;
	/** All files the PR changes; `files` lists at most the first 100. */
	changedFiles: number;
	files: PullRequestFile[];
	/** The head commit's checks, failing first, then pending, passing, and skipped. */
	checks: PullRequestCheck[];
	threads: PullRequestThread[];
	/** Comments and reviews, oldest first: the latest 50 of each. */
	conversation: PullRequestEvent[];
	/** In ms since the epoch. */
	createdAt: number;
}

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
	/** Questions the session waits on, oldest first. */
	requests: UserRequest[];
	/** What waits on the main agent's turn. */
	queue: MessageQueue;
}

export type RosterHost = RosterHostBase &
	(
		| { source: "terminal"; participants: number; relayConnected: boolean }
		/** Started by this dashboard, which can end it. */
		| { source: "dashboard"; thinkingLevels: string[]; modelSwitch: { pending: boolean; revision: number } }
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
	/** What the session and its subagents submitted or worked on; the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents read, changed, opened, or commented on, by identifier; the session's own first. */
	tickets: string[];
	ship: ShipProgress | null;
	/** The dashboard started it, and it stopped without **End session**: with the dashboard server, or on its own. */
	interrupted: boolean;
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

export type Item =
	/**
	 * `skill`: the skill a `/skill:<name>` prompt invoked, with `text` holding only what the user typed after it; `null` for
	 * any other prompt. `entryId`: the session-file entry omp can branch at; `null` for Collab and skill prompts and prompts
	 * not yet in the file. `images`: the addresses of the images the prompt carried, a `data:` URL or `/api/image`; absent
	 * when it carried none.
	 */
	| { id: string; kind: "user"; text: string; skill: string | null; from: string | null; entryId: string | null; images?: string[] }
	| { id: string; kind: "assistant"; text: string; streaming: boolean; suggestions: string[] }
	/** `agents`: the subagents a `task` call spawned, by id, in the order they appeared; empty for every other tool. */
	| { id: string; kind: "tool"; name: string; summary: string; status: "running" | "ok" | "error"; agents: string[] }
	| { id: string; kind: "notice"; level: "info" | "warning" | "error"; text: string };

/** omp's todo statuses (`pi-tui/src/tools/todo.ts`). */
export const TODO_STATUSES = ["pending", "in_progress", "completed", "abandoned", "blocked"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
	content: string;
	status: TodoStatus;
}

export interface TodoPhase {
	name: string;
	tasks: TodoItem[];
}

/** One successful `edit` or `write` result on a file; `at` is when omp recorded it, in ms since the epoch, or `null` when its entry carries no time. */
export type FileChange =
	/** An edit, with the lines its diff adds and removes; `diff` is omp's numbered-line form, `null` when omp recorded an empty one. */
	| { tool: "edit"; kind: "created" | "edited" | "deleted"; at: number | null; added: number; removed: number; diff: string | null }
	/**
	 * A write, which replaces the whole file and records no diff: `created` when the transcript had not read or changed
	 * the path before, else `rewritten`. `lines` counts what it wrote, `null` when the transcript lacks its call.
	 */
	| { tool: "write"; kind: "created" | "rewritten"; at: number | null; lines: number | null };

export type FileChangeKind = FileChange["kind"];

/** A file the agent's `edit` and `write` calls changed. */
export interface ChangedFile {
	/** Relative to the transcript's working directory when inside it, else absolute with the home directory as `~`. */
	path: string;
	/** Every change, oldest first; never empty. */
	changes: FileChange[];
}

/** One line of omp's numbered diff: `+12|added`, `-12|removed`, ` 12|context`. */
export interface DiffLine {
	sign: "+" | "-" | " ";
	number: string;
	text: string;
}

const DIFF_LINE = /^([+\- ])\s*(\d+)\|(.*)$/;

/** A line of omp's numbered diff, or `null` for the blank line it puts between hunks. */
export function parseDiffLine(line: string): DiffLine | null {
	const parts = DIFF_LINE.exec(line);
	return parts ? { sign: parts[1] as DiffLine["sign"], number: parts[2], text: parts[3] } : null;
}

/** Lines a change adds and removes: an edit's diff counts; a created file's write adds every line it wrote; a rewrite counts none, as omp records no diff of it. */
export function lineDelta(change: FileChange): { added: number; removed: number } {
	switch (change.tool) {
		case "edit":
			return { added: change.added, removed: change.removed };
		case "write":
			return { added: change.kind === "created" ? (change.lines ?? 0) : 0, removed: 0 };
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}

/** Lines added and removed over every change. */
export function lineTotals(changes: readonly FileChange[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const change of changes) {
		const delta = lineDelta(change);
		added += delta.added;
		removed += delta.removed;
	}
	return { added, removed };
}

/** What the transcript did to a file over all its changes: deleted it last, created it first, else edited it. */
export type FileStatus = "created" | "edited" | "deleted";

export function fileStatus(changes: ChangedFile["changes"]): FileStatus {
	if (changes[changes.length - 1].kind === "deleted") return "deleted";
	return changes[0].kind === "created" ? "created" : "edited";
}

/** The text of the plan file the agent wrote or edited last; `path` shows as a {@link ChangedFile}'s does. */
export interface PlanDocument {
	path: string;
	text: string;
}

/** What one transcript planned and changed: its latest todo list, its latest plan file, and the files it touched in first-touch order. */
export interface SessionWork {
	phases: TodoPhase[];
	files: ChangedFile[];
	plan: PlanDocument | null;
}

export const EMPTY_WORK: SessionWork = { phases: [], files: [], plan: null };

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

/** A local branch, and the worktree that has it checked out, `null` when none has. */
export interface LocalBranch {
	name: string;
	worktree: string | null;
}

/** The git checkout a directory is in: what the new-session draft's branch picker lists and a session's header names. */
export interface GitCheckout {
	/** The GitHub repository that `origin` names, `null` when `origin` is not on GitHub. */
	github: Repo | null;
	/** The branch checked out in the directory, `null` when HEAD is detached. */
	branch: string | null;
	/** Every local branch, the checked-out one first, then the most recently committed to. */
	branches: LocalBranch[];
	/** The repository's main worktree, beside which new worktrees go. */
	mainWorktree: string;
}

/** Where a new worktree for `branch` goes: beside the main worktree, named after both (`~/code/app-fix-login` for `fix/login`). */
export const worktreeDir = (mainWorktree: string, branch: string): string => `${mainWorktree}-${branch.replace(/[^\w.-]+/g, "-")}`;

/**
 * The branch a new session works on: an existing one, in the worktree that has it checked out (a new worktree beside
 * the main one when none has), or a new branch from `base`, always in a new worktree.
 */
export type BranchChoice = { kind: "existing"; name: string } | { kind: "new"; name: string; base: string };

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

/** Supported draft thinking levels from omp's catalog, separate from the model's identity. */
export interface ModelCapabilities {
	model: ModelOption;
	thinkingLevels: string[];
}

/** Models and their capabilities offered to a new-session draft. */
export interface ConnectedModels {
	models: ModelOption[];
	capabilities: ModelCapabilities[];
}

/** `model` as omp's selector names it. */
export const selectorOf = ({ provider, id }: ModelOption): string => `${provider}/${id}`;

/** A role in omp's `modelRoles`, such as `plan`, as the model and thinking level its selector names. */
export interface ModelRole {
	role: string;
	model: ModelOption;
	/** The selector's `:level` suffix; `null` keeps the session's thinking level. */
	thinking: string | null;
}

/** A model role: the selector omp uses for it and the fallbacks it walks after that selector, in order. */
export interface RoleRoute {
	role: string;
	/** `null` when only a fallback chain names the role. */
	primary: string | null;
	fallbacks: string[];
	/** The role has no chain of its own, so omp walks the `default` chain. */
	inheritsDefault: boolean;
}

/** A chain keyed by a model selector or a `provider/*` wildcard. It applies whenever that model is active, whatever the role. */
export interface ModelChain {
	key: string;
	fallbacks: string[];
}

/** omp's `retry.*` settings, defaults filled in. */
export interface RetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	waitForUsageReset: boolean;
	modelFallback: boolean;
	usageAwareFallback: boolean;
	usageReservePct: number;
	usageReservePolicy: string;
	fallbackRevertPolicy: string;
}

export interface ModelRouting {
	roles: RoleRoute[];
	modelChains: ModelChain[];
	retry: RetrySettings;
	/** The values omp accepts for each enum `retry.*` setting. */
	retryChoices: Partial<Record<keyof RetrySettings, readonly string[]>>;
	modelProviderOrder: string[];
}

/** A model `omp models` lists. `thinking` holds the levels it takes as a `:level` suffix on its selector. */
export interface CatalogModel {
	selector: string;
	provider: string;
	name: string;
	thinking: string[];
}

/**
 * A selector as the model `omp models` lists and its `:level` thinking suffix. Model ids can hold colons
 * (`minimax-m3:batch`), so the suffix splits off only when the rest is a listed model and the whole is not.
 */
export function splitSelector(selector: string, models: ReadonlyMap<string, CatalogModel>): { model: string; level: string | null } {
	const colon = selector.lastIndexOf(":");
	if (colon < 0 || models.has(selector) || !models.has(selector.slice(0, colon))) return { model: selector, level: null };
	return { model: selector.slice(0, colon), level: selector.slice(colon + 1) };
}

/**
 * `PUT /api/settings/routing`: one change to omp's model routing, written to the user's `config.yml` through omp.
 * An absent field stays as it is. An empty `fallbacks` removes the chain, so a role walks the `default` chain again.
 */
export type RoutingEdit =
	| { kind: "role"; role: string; primary?: string; fallbacks?: string[] }
	| { kind: "model-chain"; key: string; fallbacks: string[] }
	| { kind: "retry"; values: Partial<RetrySettings> }
	| { kind: "provider-order"; providers: string[] };

/** `PUT /api/settings/file`: new text for a file the page listed. `baseHash` is the hash it was read with, `null` if it was missing. */
export interface FileEdit {
	path: string;
	text: string;
	baseHash: string | null;
}

/** The body of every failed settings request. `conflict`: the file changed on disk since the page read it. */
export interface SettingsError {
	error: string;
	conflict?: true;
}

/** `PUT /api/pull-request/sessions`: write links to these sessions, each linked to the PR, into its description on GitHub. */
export interface SessionLinksEdit extends PullRequest {
	sessionIds: string[];
}

/** The answer to a {@link SessionLinksEdit}: whether the description changed. A rerun with the same sessions changes nothing. */
export interface SessionLinksResult {
	changed: boolean;
}

/** What a file feeds into omp: instructions, settings, or something it can run. */
export type OmpFileKind = "context" | "system-prompt" | "append-system" | "settings" | "agent" | "command" | "rule" | "skill" | "hook";

/** A file omp reads, as found on disk. */
export interface OmpFile {
	kind: OmpFileKind;
	scope: "user" | "project";
	path: string;
	/** `path` with the home directory shortened to `~`. */
	pathDisplay: string;
	/** `hash` is the SHA-256 of `text`; a save must name it, so a file changed on disk since is not overwritten. */
	body: { state: "read"; size: number; modifiedAt: number; text: string; hash: string } | { state: "missing" } | { state: "unreadable"; error: string };
}

/** `GET /api/settings`: omp's model routing and files, as a session in `cwd` would load them. */
export interface OmpSettings {
	/** The workspace whose project files and settings are included; `null` for user-level only. */
	cwd: string | null;
	/** `error` is omp's reason when it cannot load the settings, for example a malformed `config.yml`. */
	routing: ModelRouting | { error: string };
	files: OmpFile[];
}

/** What a todo points to: a session it started or came from, a pull request, or a Linear issue. */
export type UserTodoLink =
	| { kind: "session"; sessionId: string }
	| { kind: "pull-request"; owner: string; repo: string; number: number }
	| { kind: "ticket"; identifier: string };

/** A todo of your own, on the Todo page, under a top-level one. It holds none, so the list is two deep at most. */
export interface UserTodoLeaf {
	id: string;
	/** Its title, one line. */
	text: string;
	/** Its markdown content, `""` for none. */
	body: string;
	/** When it was checked, as an ISO 8601 time; `null` while it is to do. */
	doneAt: string | null;
	/** The day it is due, `YYYY-MM-DD`; `null` for none. */
	due: string | null;
}

/** A top-level todo of the Todo page, in category `categoryId` (`null` for none), with its own todos in order, which share its category. */
export interface UserTodo extends UserTodoLeaf {
	categoryId: string | null;
	children: UserTodoLeaf[];
	/** What it points to, each once, in the order they were linked. */
	links: UserTodoLink[];
	/** The session whose agent added it through omp's `user_todo` tool; `null` when you did. */
	addedBy: string | null;
}

/** A category of the Todo page, which the sidebar lists to show its todos alone. */
export interface UserTodoCategory {
	id: string;
	name: string;
}

/** The Todo page's categories and todos, each in order, and the todos **Clear done** put away, latest first. */
export interface UserTodoList {
	categories: UserTodoCategory[];
	todos: UserTodo[];
	archive: UserTodo[];
}

/**
 * One edit of the Todo page's list. A change that names no todo or category, or would nest a todo three deep, changes
 * nothing. The page picks every new `id`, so an add sent twice adds once.
 */
export type UserTodoChange =
	/**
	 * After todo `afterId` among `parentId`'s todos (the top level for `null`), or last for `null`. A top-level todo goes
	 * in category `categoryId`, or in none when that category is gone; one under another goes in its parent's. A top-level
	 * todo takes `links` and `addedBy`; any todo takes `body` and `due`. Each is none when not given.
	 */
	| {
			op: "add";
			id: string;
			parentId: string | null;
			afterId: string | null;
			categoryId: string | null;
			text: string;
			body?: string;
			due?: string | null;
			links?: UserTodoLink[];
			addedBy?: string | null;
	  }
	| { op: "edit"; id: string; text: string }
	| { op: "edit-body"; id: string; body: string }
	/** Checks a todo at `doneAt`, or unchecks it for `null`. Checking a top-level todo checks its todos too. */
	| { op: "toggle"; id: string; doneAt: string | null }
	/** A todo of the list or of the archive, with its todos. */
	| { op: "remove"; id: string }
	/** Puts back a todo `remove` took at `index` among the top-level todos, or among top-level todo `parentId`'s, which holds leaves only. */
	| { op: "restore"; parentId: null; todo: UserTodo; index: number }
	| { op: "restore"; parentId: string; todo: UserTodoLeaf; index: number }
	/**
	 * A top-level todo goes right after top-level todo `afterId`, or first among category `categoryId`'s for `null`, and
	 * joins category `categoryId`. A todo under another goes after `afterId` among its parent's todos, or first for `null`.
	 */
	| { op: "move"; id: string; afterId: string | null; categoryId: string | null }
	| { op: "set-due"; id: string; due: string | null }
	/** On a top-level todo; a link it already holds changes nothing. */
	| { op: "link"; id: string; link: UserTodoLink }
	| { op: "unlink"; id: string; link: UserTodoLink }
	/** A top-level todo without todos of its own goes last under the top-level todo above it in its category. */
	| { op: "indent"; id: string }
	/** A todo under another goes to the top level right after it, and takes the todos below it along, so the list reads in the same order. */
	| { op: "outdent"; id: string }
	/** A top-level todo, with its todos, moves to category `categoryId`, or to none for `null`. */
	| { op: "categorize"; id: string; categoryId: string | null }
	/**
	 * Moves every checked todo of category `categoryId`, or of the whole list for `null`, to the archive. A checked todo
	 * under an unchecked one goes there as a top-level todo of its parent's category.
	 */
	| { op: "clear-done"; categoryId: string | null }
	/** An archived todo goes back last in the list, in its category when that still exists. */
	| { op: "unarchive"; id: string }
	| { op: "empty-archive" }
	/** Last among the categories. */
	| { op: "add-category"; id: string; name: string }
	| { op: "rename-category"; id: string; name: string }
	/** Its todos stay, in no category, archived ones too. */
	| { op: "remove-category"; id: string };

export type ServerMsg =
	| { t: "roster"; hosts: RosterHost[]; error: string | null }
	/** Newest first. */
	| { t: "past"; sessions: PastSession[] }
	/** `reset` replaces the view's transcript; otherwise `items` are upserts by id, new ids appended. */
	| { t: "items"; view: View; reset: boolean; items: Item[] }
	/** The view's plan and changed files, whole, sent with its transcript and again whenever either changes. */
	| { t: "work"; view: View; work: SessionWork }
	/** Answers this socket's `start` with `reqId` once the session is ready, or once starting it failed. */
	| { t: "started"; reqId: number; result: StartResult }
	/** Answers this socket's `resume-all` with `reqId` once every session is ready or failed to start. */
	| { t: "resumed-all"; reqId: number; started: { sessionId: string; instanceId: string }[]; errors: string[] }
	/** Answers this socket's `complete` for `scope`; `reqId` counts per composer. */
	| { t: "completions"; scope: CompletionScope; reqId: number; items: CompletionItem[]; error: string | null }
	/** Plans as of the last `omp usage` run. `error` is set, and `plans` empty, when that run failed. */
	| { t: "usage"; plans: PlanUsage[]; error: string | null }
	/** Answers `list-models`. `error` is set when the session cannot list or switch models. */
	| { t: "models"; instanceId: string; models: ModelOption[]; error: string | null }
	/** Answers this socket's `dequeue` with the texts it took out of the queue, oldest first. Nothing answers when every message had gone. */
	| { t: "dequeued"; view: LiveView; reqId: number; texts: string[] }
	/** The Todo page's list, whole, sent when a socket opens and after every change. */
	| { t: "user-todos"; list: UserTodoList };

export type ClientMsg =
	/** The views this socket shows, replacing the last set: each new one gets its transcript, dropped ones stop streaming. */
	| { t: "watch"; views: View[] }
	/**
	 * A prompt to the session, or chat to the subagent (prompt if idle, revive if parked); `delivery` applies while a turn
	 * runs. Only the session's own agent takes `images`.
	 */
	| { t: "prompt"; view: LiveView; text: string; images: PromptImage[]; delivery: Delivery }
	/** Take `messages` out of the view's queue before the agent gets them. `reqId` counts per view. */
	| { t: "dequeue"; reqId: number; view: LiveView; messages: { queue: keyof MessageQueue; text: string }[] }
	| { t: "abort"; instanceId: string }
	/** Suggestions for the composer text with the caret at `cursor`, resolved against the scope's cwd and its skills and commands. */
	| { t: "complete"; reqId: number; scope: CompletionScope; text: string; cursor: number }
	/** End a live session: stop the omp process this dashboard started, or send SIGTERM to a terminal session's omp. */
	| { t: "end"; instanceId: string }
	/** Start a dashboard session. `reqId` counts per page and comes back with the answer. */
	| ({ t: "start"; reqId: number } & StartRequest)
	/** Resume each of these past sessions, as `start` with `resume` does. `reqId` counts per page and comes back with the answer. */
	| { t: "resume-all"; reqId: number; sessionIds: string[] }
	/** Move an interrupted session to the past sessions. */
	| { t: "dismiss-interrupted"; sessionId: string }
	/** Models a session this dashboard started can switch to. */
	| { t: "list-models"; instanceId: string }
	/** Switch a session this dashboard started to another model and, when `thinking` names one, thinking level, as picking a model role does. */
	| { t: "set-model"; instanceId: string; model: ModelOption; thinking: string | null }
	/** Switch a session this dashboard started to another thinking level, one of its `thinkingLevels`. */
	| { t: "set-thinking"; instanceId: string; level: string }
	/** Reply to one of a live session's pending `requests`. */
	| { t: "answer"; instanceId: string; requestId: string; answer: UserAnswer }
	/** Cancel a running subagent of a live session without stopping the session's turn; it cannot be revived after. */
	| { t: "cancel-agent"; view: LiveView & { agentId: string } }
	/** Change the Todo page's list; every socket then gets the list as it is after. */
	| { t: "user-todo"; change: UserTodoChange };
