/**
 * The HTTP API the page reads and writes omp's settings, analytics, pull requests, git checkouts, worktrees,
 * the workspaces Settings adds and hides, the machine's load, the terminal panel's shells, the integrations, the model providers omp signs in to, Linear tickets and their files, the Linear issue a todo opens, Google Calendar and the events kept on this computer, your Gmail inbox, prompt images, the text files agent text names through, and the dashboard's own update.
 * Every read goes through `get` and every write through `write`; each route group takes only the part of {@link RouteEnv} it reads.
 */
import { join } from "node:path";
import { buildAnalytics, type SessionSummary, withForeignUsage } from "../analytics";
import { buildContextReport } from "../context-sources";
import { readGithubMedia } from "../github-media";
import { errorText, isNonEmpty, isObject, type Parsed } from "../json";
import { listSkills } from "../commands";
import { listChanges, readChangedFile, type SessionPlace } from "../changes";
import type { FileUsage } from "../foreign/usage";
import { gitCheckout } from "../git";
import type { GoogleCalendars } from "../google-calendar";
import type { GmailAccounts } from "../gmail";
import { loadPullRequests, loadPullRequestDetail, loadPullRequestTitle } from "../pull-requests";
import type { Integrations } from "../integrations";
import { addMcpServerFrom, loadMcpServers, McpServerRejected, removeMcpServerNamed, setMcpServerEnabledFrom, signOutMcpServer, startMcpServerSignIn } from "../mcp-servers";
import { answerProviderLogin, cancelProviderLogin, loadProviders, signOutProvider, startProviderLogin } from "../providers";
import { blobsDir } from "../omp/config";
import { connectedModels, connectedRoles, listModels } from "../omp/models";
import { contextIndex } from "../omp/context-index";
import { sessionsDir } from "../omp/sessions";
import { readStats, windowOf } from "../omp/stats";
import { directoryOf } from "../paths";
import { attachToPullRequest, loadPullRequestOptions, markPullRequestFileViewed, savePullRequest } from "../pull-request-edit";
import { InvalidPullRequestCommit, listPullRequestChanges, readPullRequestFile } from "../pull-request-files";
import { loadPullRequestStack } from "../pull-request-stack";
import { loadOmpSettings, Rejected, saveOmpFile, saveRouting } from "../settings";
import { attachToTicket, createTicket, loadTeams, loadTicketDetail, loadTicketMedia, loadTicketOptions, loadTickets, saveTicket } from "../tickets";
import { isUploadPath } from "../linear-uploads";
import { ClientConfigError } from "../mcp-clients";
import { type AccountId, GOOGLE_SERVICES, type GoogleService, type IntegrationTarget, type McpIntegration } from "../shared/accounts";
import type { LocalEventsAnswer, NewEventAnswer } from "../shared/calendar";
import { isAnalyticsRange } from "../shared/analytics";
import { MAX_PULL_REQUEST_ATTACHMENTS, MAX_PULL_REQUEST_IMAGE_BYTES, parsePullRequest, type PullRequest, prKey, type Repo } from "../shared/github";
import type { ReviewDraft, ReviewPreview, ReviewSubmit } from "../shared/review-drafts";
import type { ProjectNotesAnswer } from "../shared/projects";
import { type ConversationHit, type ConversationSearchAnswer, PROMPT_IMAGE_TYPES } from "../shared/sessions";
import { TICKET_ID } from "../shared/tickets";
import type { WorkspaceChange } from "../shared/workspaces";
import type { ReplayComparison, ReplayDetail } from "../shared/replay";
import { MEDIA_FILE_TYPES } from "../shared/transcript";
import type { View } from "../shared/sessions";
import { parseReviewDraftPost, parseView } from "./wire";
import { SystemLoadReader } from "../system-load";
import { findMediaFile, readTextFile } from "../local-file";
import type { Terminals } from "../terminals";
import type { Worktrees } from "../worktrees";
import { MAX_WORKTREE_BATCH } from "../worktrees-shared";
import { answer, fail, type Guards } from "./http";
import type { LocalEventsFile } from "./local-events-file";
import { mailDocument } from "./mail-document";
import { listNotes } from "./project-notes";
import { createTicketForTodo, type TodoTicketEnv, TodoTicketRefused } from "./todo-ticket";
import {
	MAX_QUEUED_STACK, parseBranchRelease, parseCalendarShown, parseEventRef, parseGoogleClient, parseGoogleLinks, parseIntegrationTarget, parseLoginAnswer, parseLoginMethod, parseMailReply, parseMailSend, parseMailTrash, parseMcpServerAdd, parseMcpServerEnabled, parseMcpServerName, parseMergeQueueChange, parseNewEvent, parsePromptDocument, parseProviderSignOut, parsePullRequestAttachment,
	parsePullRequestEdit, parsePullRequestFilesQuery, parsePullRequestQuery, parsePullRequestViewedEdit, parseRepoQuery, parseSlackClient, parseSourceControlChange, parseSyncRun, parseTicketAttachment, parseTicketDraft, parseTicketEdit, parseTodoTicket, parseWorkspaceChange, parseWorktreeRemoval, SHA256, UUID,
} from "./wire";
import type { SourceControlAnswer, SourceControlChange } from "../shared/source-control";
import type { MergeQueueAnswer, MergeQueueChange } from "../shared/merge-queue";
import { MAX_TICKET_ATTACHMENT_BYTES } from "../shared/tickets";
import { MAX_PROMPT_DOCUMENT_BYTES } from "../shared/prompt-files";
import { documentText, UnreadableDocument } from "../omp/documents";
import type { DashboardUpdateOutcome, DashboardUpdateStatus } from "../shared/dashboard-update";
import { UpdateRefused } from "./self-update";
import { parseSyncSettings, type SyncAnswer, type SyncSettings, type SyncSide } from "../shared/settings-sync";
import { parseTriageApply } from "../shared/review-triage";
import type { ReviewTriages } from "./review-triages";

/** The longest span `GET /api/calendar/events` reads: a month view's six weeks, with room to spare. */
const MAX_EVENT_SPAN_MS = 62 * 86_400_000;

/** What the session routes read: the directories sessions ran in, their files, and the workspaces Settings keeps. */
export interface SessionRoutesEnv {
	/** Directories sessions ran in: live ones first, then saved ones newest first. */
	knownCwds(): string[];
	/** The directories Settings → Workspaces added, which the page names as workspaces before any session runs there. */
	addedCwds(): string[];
	/** Apply `change` to the workspaces and send every socket the workspaces after it. */
	changeWorkspaces(change: WorkspaceChange): void;
	/** The listed file of a session, for Analytics' title and working directory. */
	savedOf(sessionId: string): SessionSummary | null;
	/** The requests Claude Code's and Codex's transcripts record, each transcript read past what earlier reads folded. */
	foreignUsage(): Promise<FileUsage[]>;
	/** Where session `sessionId` works, for its changes; `null` while its file is not listed. */
	placeOf(sessionId: string): SessionPlace | null;
	/** The pull request list loaded `repo`'s pull requests, which tells which branch heads which PR and so links the sessions that pushed them. */
	learnHeads(repo: Repo, pullRequests: readonly (PullRequest & { head: string })[]): void;
	/** The notes directory of project `id`, or `null` when there is no such project. */
	projectNotesDir(id: string): string | null;
	/** The user's notes directory, which every project shares. */
	userNotesDir: string;
	/** The saved conversations whose prompts or replies hold every word of `query`, the file changed last first. */
	searchConversations(query: string): Promise<ConversationHit[]>;
	sourceControl(): Promise<SourceControlAnswer>;
	/** Apply `change` to the source control settings, and pull again when it changed the automatic pulls. */
	changeSourceControl(change: SourceControlChange): void;
	replayDetail(view: View, turnId: string): Promise<ReplayDetail>;
	replayComparison(view: View): Promise<ReplayComparison>;
}

/** What the calendar routes read: every Google Calendar account, the calendars each shows, and the events kept on this computer. */
export interface CalendarRoutesEnv {
	google: GoogleCalendars;
	/** Show or hide calendar `id` of Google Calendar account `account` on the Calendar page, and save the choice. */
	setCalendarShown(account: AccountId, id: string, shown: boolean): void;
	localEvents: LocalEventsFile;
}

/** What the file routes read: the registered worktrees and the terminal panel's shells. */
export interface FileRoutesEnv {
	worktrees: Worktrees;
	terminals: Terminals;
}

/** What the todo routes read and write: the Todo page's list. */
export type TodoRoutesEnv = Omit<TodoTicketEnv, "createTicket">;

/** What the dashboard update routes read: where the server stands, and **Update dashboard** itself. */
export interface DashboardRoutesEnv {
	status(): Promise<DashboardUpdateStatus>;
	update(): Promise<DashboardUpdateOutcome>;
}

/** What the settings sync routes read and run: Settings › Sync. */
export interface SyncRoutesEnv {
	answer(): SyncAnswer;
	configure(settings: SyncSettings): SyncAnswer;
	sync(choices: Record<string, SyncSide>): Promise<SyncAnswer>;
}

/** Everything the HTTP API reads, by concern. */
export interface RouteEnv {
	guards: Guards;
	sessions: SessionRoutesEnv;
	/** The MCP integrations, Gmail's and Google Calendar's accounts included. */
	integrations: Integrations;
	calendar: CalendarRoutesEnv;
	gmail: GmailAccounts;
	files: FileRoutesEnv;
	todos: TodoRoutesEnv;
	pullRequests: PullRequestRoutesEnv;
	dashboard: DashboardRoutesEnv;
	sync: SyncRoutesEnv;
	reviewTriages: Pick<ReviewTriages, "apply" | "startFromSession">;
}

/** What the pull request routes hand on: the merge queue, through which every merge goes. */
export interface PullRequestRoutesEnv {
	/** Apply `change` to the merge queue; answers the queued merges after it and what it merged, or rejects with why it refused. */
	changeMergeQueue(change: MergeQueueChange): Promise<MergeQueueAnswer>;
	/** What posting the pull request's review draft sends now, and why it cannot post, if it cannot; rejects when there is no draft. */
	previewReviewDraft(pr: PullRequest): Promise<ReviewPreview>;
	/** Posts the pull request's review draft once, first with the composer's `submit` applied, and answers it marked posted; rejects with why it cannot. */
	postReviewDraft(pr: PullRequest, submit?: ReviewSubmit): Promise<ReviewDraft>;
}

type Handler = (req: Request) => Promise<Response>;
/** HTTP handlers by path and method, as `Bun.serve` takes them. */
export type Routes = Record<string, Partial<Record<"GET" | "PUT", Handler>>>;

/** The two ways a route answers: a read of its query, and a write of its JSON body. */
interface RouteKit {
	/** A read: admitted like every other, then handed the request's query. */
	get(handle: (params: URLSearchParams, req: Request) => Response | Promise<Response>): Handler;
	/**
	 * A write: admitted with its JSON body (origin, content type, size), `parse`d with the request's query into an input or the
	 * response refusing it, then `run`; `refuse` answers an error `run` throws, and any other is a 500 with its text.
	 */
	write<T>(parse: (body: unknown, params: URLSearchParams) => T | Response | Promise<T | Response>, run: (input: T) => Promise<unknown>, refuse?: (err: unknown) => Response | null): Handler;
}

function routeKit(guards: Guards): RouteKit {
	return {
		get: handle => async req => guards.admit(req) ?? handle(new URL(req.url).searchParams, req),
		write: (parse, run, refuse) => async req => {
			const guarded = await guards.writeBody(req);
			if (guarded instanceof Response) return guarded;
			const input = await parse(guarded.body, new URL(req.url).searchParams);
			return input instanceof Response ? input : answer(() => run(input), refuse);
		},
	};
}

/** The value `parsed` holds, or a 400 with the parser's own reason, else with `badRequest`. */
function checked<T>(parsed: Parsed<T>, badRequest: string): T | Response;
function checked<T>(parsed: Parsed<T, { error: string }>): T | Response;
function checked<T>(parsed: Parsed<T, { error: string } | null>, badRequest = ""): T | Response {
	if (parsed && "ok" in parsed) return parsed.ok;
	return fail(400, parsed ? parsed.error : badRequest);
}

/** The directory `?cwd=` names, or the response refusing it. Like a new session, `cwd` may name any directory. */
async function dirParam(params: URLSearchParams): Promise<string | Response> {
	return (await directoryOf(params.get("cwd") ?? "")) ?? fail(404, "Expected ?cwd= naming a directory");
}

/** Settings, models, skills, analytics, the pull request list, workspaces, and a session's changes. */
function sessionRoutes({ get, write }: RouteKit, env: SessionRoutesEnv): Routes {
	/**
	 * The `cwd` a request names, `null` when it names none, or the response refusing it. `cwd` must be a
	 * directory some session ran in or Settings → Workspaces added: the page names workspaces that way, as it names sessions by id.
	 */
	function workspaceCwd(params: URLSearchParams): string | null | Response {
		const cwd = params.get("cwd");
		return cwd === null || env.knownCwds().includes(cwd) || env.addedCwds().includes(cwd) ? cwd : fail(404, `No session ran in ${cwd}`);
	}

	const replayRead = (compare: boolean) => get(params => answer(async () => {
		const parsed = parseView(JSON.parse(params.get("view") ?? "null"));
		if (!parsed || parsed.ok.kind === "live" && parsed.ok.agentId !== null) throw new Error("Replay requires a main session.");
		const turnId = params.get("turnId");
		if (compare) return env.replayComparison(parsed.ok);
		if (!turnId) throw new Error("Choose a prompt turn to replay.");
		return env.replayDetail(parsed.ok, turnId);
	}));

	/** `GET /api/settings[?cwd=<dir>]`: omp's model routing and files, user-level only without `cwd`. */
	const settings = get(params => {
		const cwd = workspaceCwd(params);
		return cwd instanceof Response ? cwd : answer(() => loadOmpSettings(cwd));
	});

	/**
	 * A settings write: `PUT /api/settings/routing` or `/api/settings/file`, `?cwd=` as for reading.
	 * The answer is the settings as they load after the write, or the edit's refusal with its status.
	 */
	const settingsWrite = (save: (cwd: string | null, body: unknown) => Promise<unknown>): Handler =>
		write(
			(body, params) => {
				const cwd = workspaceCwd(params);
				return cwd instanceof Response ? cwd : { cwd, body };
			},
			({ cwd, body }) => save(cwd, body),
			err => (err instanceof Rejected ? fail(err.status, err.message, err.conflict) : null),
		);

	/** `GET /api/models`: the models omp lists, for the settings page's pickers. */
	const models = get(() => answer(async () => ({ models: await listModels() })));

	/** `GET /api/models/connected?cwd=<dir>`: the models of the providers you are connected to, for the new-session draft's model picker. */
	const connected = get(async params => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => connectedModels(cwd));
	});

	/** `GET /api/models/roles?cwd=<dir>`: omp's model roles a session in that directory could switch to. */
	const roles = get(async params => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(async () => ({ roles: await connectedRoles(cwd) }));
	});

	/** `GET /api/analytics?range=`: omp-stats' request usage and live sync state, with Claude Code's and Codex's requests. */
	const analytics = get(params => {
		const value = params.get("range") ?? "24h";
		if (!isAnalyticsRange(value)) return fail(400, "Unknown analytics range");
		return answer(async () => {
			const [read, foreign] = await Promise.all([readStats(value), env.foreignUsage()]);
			return buildAnalytics(value, withForeignUsage(read, foreign), sessionsDir, env.savedOf);
		});
	});

	/**
	 * `GET /api/analytics/context?range=[&cwd=<dir>][&session=<id>]`: the context sources over the range, one workspace's or
	 * one session's when named, from the index, which syncs in the background as it answers.
	 */
	const contextReport = get(params => {
		const range = params.get("range") ?? "24h";
		if (!isAnalyticsRange(range)) return fail(400, "Unknown analytics range");
		return answer(async () => {
			const index = contextIndex();
			index.refresh();
			const rows = index.read(windowOf(range, Date.now()).cutoff);
			return buildContextReport({ range, cwd: params.get("cwd"), sessionId: params.get("session"), indexing: index.progress, ...rows, root: sessionsDir, factsOf: env.savedOf });
		});
	});

	/** `GET /api/skills?cwd=<dir>`: the skills a session started in that directory can invoke. */
	const skills = get(async params => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(async () => ({ skills: await listSkills(cwd) }));
	});

	/**
	 * `GET /api/pull-requests[?cwd=<dir>][&fresh]`: the pull requests of that workspace's repository, else of every workspace's.
	 * Each answer also tells the pull-request index which branch heads which PR, which links the sessions that pushed them.
	 */
	const pullRequests = get(params => {
		const cwd = workspaceCwd(params);
		if (cwd instanceof Response) return cwd;
		const fresh = params.has("fresh");
		return answer(async () => {
			const loaded = await loadPullRequests(cwd === null ? env.knownCwds() : [cwd], fresh);
			for (const repo of loaded.repos) if ("pullRequests" in repo) env.learnHeads(repo, repo.pullRequests);
			return loaded;
		});
	});

	/** `PUT /api/workspaces` `{ op, cwd }`: add a directory as a workspace, or hide or show one. */
	const workspaceChange = write(
		async (body): Promise<WorkspaceChange | Response> => {
			const change = checked(parseWorkspaceChange(body), "Expected { op, cwd } with op add, hide, or show");
			if (change instanceof Response || change.op !== "add") return change;
			const cwd = await directoryOf(change.cwd);
			return cwd ? { op: "add", cwd } : fail(400, `${change.cwd.trim()} is not a directory.`);
		},
		async change => {
			env.changeWorkspaces(change);
			return {};
		},
	);

	/** `GET /api/source-control`: GitHub's and Graphite's CLIs, the automatic pull setting, and the workspaces' repositories. */
	const sourceControl = get(() => answer(() => env.sourceControl()));

	/** `PUT /api/source-control` `{ op, on, repo? }`: turn automatic pulls on or off by default, or for one repository, or the cleanup after a merge. */
	const sourceControlChange = write(
		body => checked(parseSourceControlChange(body), "Expected { op: default, on }, { op: clean-up, on }, or { op: repo, repo, on } with on true, false, or null for a repository"),
		async change => {
			env.changeSourceControl(change);
			return env.sourceControl();
		},
	);

	/** The place of the session `?session=` names, or the response refusing it. */
	function sessionPlace(params: URLSearchParams): SessionPlace | Response {
		const sessionId = params.get("session") ?? "";
		return env.placeOf(sessionId) ?? fail(404, `No session ${sessionId}`);
	}

	/** `GET /api/changes?session=<id>`: the files the session's checkout changed against its branch base, and the files its own calls changed. */
	const changes = get(params => {
		const place = sessionPlace(params);
		return place instanceof Response ? place : answer(() => listChanges(place));
	});

	/** `GET /api/changes/file?session=<id>&path=<path>`: one file of that list in full, with its diff; only a path the list holds. */
	const changedFile = get(async params => {
		const place = sessionPlace(params);
		if (place instanceof Response) return place;
		const path = params.get("path") ?? "";
		const file = await readChangedFile(place, path).catch((err: unknown) => fail(500, errorText(err)));
		if (file instanceof Response) return file;
		return file ? Response.json(file) : fail(404, `The session changed no file ${path}`);
	});

	/** `GET /api/project-notes?id=<project id>`: the project's notes directory and the user's, with the Markdown files in each, which the file dialog opens. */
	const projectNotes = get(params => {
		const id = params.get("id") ?? "";
		const dir = env.projectNotesDir(id);
		if (dir === null) return fail(404, `No project ${id}`);
		return answer(async (): Promise<ProjectNotesAnswer> => {
			const [notes, userNotes] = await Promise.all([listNotes(dir), listNotes(env.userNotesDir)]);
			return { dir, notes, userDir: env.userNotesDir, userNotes };
		});
	});

	/** `GET /api/conversations?q=<words>`: the saved conversations whose prompts or replies hold every word, each by its latest such message. */
	const conversations = get(params => {
		const query = params.get("q")?.trim() ?? "";
		return query ? answer(async (): Promise<ConversationSearchAnswer> => ({ hits: await env.searchConversations(query) })) : fail(400, "Expected ?q= with a word to search");
	});

	return {
		"/api/settings": { GET: settings },
		"/api/settings/routing": { PUT: settingsWrite(saveRouting) },
		"/api/settings/file": { PUT: settingsWrite(saveOmpFile) },
		"/api/models": { GET: models },
		"/api/models/connected": { GET: connected },
		"/api/models/roles": { GET: roles },
		"/api/replay/detail": { GET: replayRead(false) },
		"/api/replay/compare": { GET: replayRead(true) },
		"/api/analytics": { GET: analytics },
		"/api/analytics/context": { GET: contextReport },
		"/api/skills": { GET: skills },
		"/api/pull-requests": { GET: pullRequests },
		"/api/workspaces": { PUT: workspaceChange },
		"/api/source-control": { GET: sourceControl, PUT: sourceControlChange },
		"/api/changes": { GET: changes },
		"/api/changes/file": { GET: changedFile },
		"/api/project-notes": { GET: projectNotes },
		"/api/conversations": { GET: conversations },
	};
}

/** The MCP integrations, the other MCP servers omp loads, and Linear tickets. */
function integrationRoutes({ get, write }: RouteKit, integrations: Integrations): Routes {
	/** `GET /api/integrations[?fresh]`: where omp stands with each MCP integration's server or accounts, and the sign-in the page last started. */
	const loaded = get(params => answer(() => integrations.load(params.has("fresh"))));

	/** A write of `{ id, account }` naming an MCP integration and one of its accounts, answered with that integration as `act` leaves it. */
	const integrationWrite = (act: (target: IntegrationTarget) => Promise<McpIntegration>): Handler =>
		write(body => checked(parseIntegrationTarget(body), "Expected { id, account } naming an integration and, for Gmail or Google Calendar, an account or null"), act);

	/** `PUT /api/integrations/sign-in`: starts a sign-in to an account, or adds one, and answers with its authorization address to open. */
	const integrationSignIn = integrationWrite(integrations.startSignIn);

	/** `PUT /api/integrations/remove`: signs out of the integration's server, as `/mcp unauth` does, and removes an account's server unless it is the last. */
	const integrationRemove = integrationWrite(integrations.remove);

	/** `PUT /api/integrations/google-links`: `{ address, workspaces }`, the workspaces a Google address's accounts are linked to; answers every integration. */
	const googleLinks = write(
		body => checked(parseGoogleLinks(body), "Expected { address, workspaces } naming a Google address and absolute workspace directories"),
		integrations.linkGoogleAccount,
	);

	const refuseClient = (err: unknown): Response | null => (err instanceof ClientConfigError ? fail(400, err.message) : null);

	/** `PUT /api/integrations/slack/client`: `{ clientId, clientSecret?, redirectUri, callbackPort, scope }` of your Slack app. */
	const slackClient = write(body => checked(parseSlackClient(body)), integrations.saveSlackClient, refuseClient);

	/** `PUT /api/integrations/<google-calendar|gmail>/client`: `{ clientId, clientSecret?, callbackPort }` of your Google OAuth client for that service. */
	const googleClient = (id: GoogleService): Handler => write(body => checked(parseGoogleClient(body)), input => integrations.saveGoogleClient(id, input), refuseClient);

	/** `GET /api/mcp-servers[?fresh]`: every user-level MCP server omp loads, where omp stands with each, and its sign-in under way. */
	const mcpServers = get(params => answer(() => loadMcpServers(params.has("fresh"))));

	const refuseMcp = (err: unknown): Response | null => (err instanceof McpServerRejected ? fail(400, err.message) : null);

	/** A write of `{ name }` naming an MCP server, answered with what `act` answers. */
	const mcpServerWrite = (act: (name: string) => Promise<unknown>): Handler =>
		write(body => checked(parseMcpServerName(body), "Expected { name } naming an MCP server"), act, refuseMcp);

	/** `PUT /api/mcp-servers/add`: a catalog entry or a server by its address, added to omp's user `mcp.json`; answers its row. */
	const mcpServerAdd = write(body => checked(parseMcpServerAdd(body)), addMcpServerFrom, refuseMcp);

	/** `PUT /api/mcp-servers/enabled`: `{ name, enabled }`, as `/mcp enable` and `/mcp disable` do; answers the row. */
	const mcpServerEnabled = write(
		body => checked(parseMcpServerEnabled(body), "Expected { name, enabled } naming an MCP server"),
		({ name, enabled }) => setMcpServerEnabledFrom(name, enabled),
		refuseMcp,
	);

	/** `PUT /api/mcp-servers/remove`: removes the server from omp's user `mcp.json`, as `/mcp remove` does; answers `{}`. */
	const mcpServerRemove = mcpServerWrite(async name => {
		await removeMcpServerNamed(name);
		return {};
	});

	/** `GET /api/tickets[?fresh]`: the viewer's assigned Linear issues, or why they could not be read. */
	const tickets = get(params => answer(() => loadTickets(params.has("fresh"))));

	/** `GET /api/ticket?id=<identifier>`: that Linear issue in full, for the tickets page's main content. */
	const ticket = get(params => {
		const id = params.get("id") ?? "";
		return TICKET_ID.test(id) ? answer(() => loadTicketDetail(id)) : fail(400, "Expected ?id= naming a Linear issue, such as ENG-123");
	});

	/** `PUT /api/ticket`: `TicketEdit`, applied in Linear; answers the issue in full as it is after it. */
	const ticketWrite = write(body => checked(parseTicketEdit(body), "Expected { id } naming a Linear issue and at least one field to change"), saveTicket);

	/** `PUT /api/ticket/new`: `TicketDraft`, opened in Linear; answers `{ identifier }`. */
	const ticketCreate = write(body => checked(parseTicketDraft(body), "Expected { title, description, team } naming a Linear team by id, and fields of their own types"), createTicket);

	/** `PUT /api/ticket/attachment`: `TicketAttachmentUpload`, attached to the issue in Linear; answers `{}`. */
	const ticketAttach = write(
		body => checked(parseTicketAttachment(body), `Expected { issue, name, type, data } naming a Linear issue, with a file of at most ${MAX_TICKET_ATTACHMENT_BYTES / 1024 / 1024} MB in base64`),
		async upload => {
			await attachToTicket(upload);
			return {};
		},
	);

	/** `GET /api/linear/teams`: the workspace's Linear teams, `{ id, name, key }`, for the team a new issue goes in. */
	const teams = get(() => answer(loadTeams));

	/** `GET /api/ticket/options?team=<id>`: what the field pickers offer for an issue of that Linear team. */
	const ticketOptions = get(params => {
		const team = params.get("team") ?? "";
		return UUID.test(team) ? answer(() => loadTicketOptions(team)) : fail(400, "Expected ?team= naming a Linear team by id");
	});

	/** `GET /api/ticket/media?issue=<identifier>&path=<upload path>`: a file that the issue or its comments embed, from Linear. */
	const ticketMedia = get(async (params, req) => {
		const issue = params.get("issue") ?? "";
		const path = params.get("path") ?? "";
		if (!TICKET_ID.test(issue) || !isUploadPath(path)) return fail(400, "Expected ?issue= naming a Linear issue and ?path= naming one of its files");
		try {
			return (await loadTicketMedia(issue, path, req.headers.get("range"), req.signal)) ?? fail(404, `${issue} embeds no file ${path}`);
		} catch (err) {
			return fail(502, errorText(err));
		}
	});

	return {
		"/api/integrations": { GET: loaded },
		"/api/integrations/sign-in": { PUT: integrationSignIn },
		"/api/integrations/remove": { PUT: integrationRemove },
		"/api/integrations/google-links": { PUT: googleLinks },
		"/api/mcp-servers": { GET: mcpServers },
		"/api/mcp-servers/add": { PUT: mcpServerAdd },
		"/api/mcp-servers/sign-in": { PUT: mcpServerWrite(startMcpServerSignIn) },
		"/api/mcp-servers/sign-out": { PUT: mcpServerWrite(signOutMcpServer) },
		"/api/mcp-servers/enabled": { PUT: mcpServerEnabled },
		"/api/mcp-servers/remove": { PUT: mcpServerRemove },
		"/api/integrations/slack/client": { PUT: slackClient },
		...Object.fromEntries(GOOGLE_SERVICES.map(id => [`/api/integrations/${id}/client`, { PUT: googleClient(id) }])),
		"/api/tickets": { GET: tickets },
		"/api/linear/teams": { GET: teams },
		"/api/ticket": { GET: ticket, PUT: ticketWrite },
		"/api/ticket/new": { PUT: ticketCreate },
		"/api/ticket/attachment": { PUT: ticketAttach },
		"/api/ticket/options": { GET: ticketOptions },
		"/api/ticket/media": { GET: ticketMedia },
	};
}

/** The Linear issue a todo opens and links. */
function todoRoutes({ write }: RouteKit, env: TodoRoutesEnv): Routes {
	/** `PUT /api/todo/ticket`: `TodoTicketRequest`; answers `TodoTicketAnswer` once the todo list holds the issue's link or could not. */
	const todoTicket = write(
		body => checked(parseTodoTicket(body), "Expected { todoId, team } naming a todo and a Linear team by id"),
		request => createTicketForTodo({ ...env, createTicket }, request),
		err => (err instanceof TodoTicketRefused ? fail(409, err.message) : null),
	);
	return { "/api/todo/ticket": { PUT: todoTicket } };
}

/** Google Calendar's calendars and events of every account, the events the Calendar page adds and deletes, and the events kept on this computer. */
function calendarRoutes({ get, write }: RouteKit, env: CalendarRoutesEnv): Routes {
	const { google, localEvents } = env;

	/** `GET /api/google[?fresh]`: the calendars checked in each account's Google Calendar list, with why each one's last read failed. */
	const googleStatus = get(params => answer(() => google.status(params.has("fresh"))));

	/** `PUT /api/google/calendars` `{ account, id, shown }`: show or hide one calendar's events on the Calendar page; answers the calendars after it. */
	const calendarShown = write(
		body => checked(parseCalendarShown(body), "Expected { account, id, shown } naming a calendar"),
		async ({ account, id, shown }) => {
			env.setCalendarShown(account, id, shown);
			return google.status();
		},
	);

	/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of every account's shown Google calendars in that span. */
	const calendarEvents = get(params => {
		const from = new Date(params.get("from") ?? "");
		const to = new Date(params.get("to") ?? "");
		const span = to.getTime() - from.getTime();
		if (!(span > 0 && span <= MAX_EVENT_SPAN_MS)) return fail(400, "Expected ?from= and ?to= ISO times, at most 62 days apart");
		return answer(() => google.events(from, to, params.has("fresh")));
	});

	/** `GET /api/calendar/local`: every event kept on this computer. */
	const localCalendarEvents = get(() => answer(async (): Promise<LocalEventsAnswer> => ({ events: [...localEvents.value] })));

	/** `PUT /api/calendar/events/new`: `NewEvent`, kept on this computer or added to a Google calendar you may write to; answers `NewEventAnswer`. */
	const eventCreate = write(
		body => checked(parseNewEvent(body), "Expected { title, when, calendar }: a title, an all-day span of days or a timed span that ends after it starts, and this computer or a Google calendar"),
		async ({ title, when, calendar }): Promise<NewEventAnswer> => {
			switch (calendar.kind) {
				case "local":
					return { kept: localEvents.add(title, when) };
				case "google":
					await google.create(calendar.account, calendar.calendarId, title, when);
					return { kept: null };
				default: {
					const unhandled: never = calendar;
					return unhandled;
				}
			}
		},
	);

	/** `PUT /api/calendar/events/delete`: `EventRef`, deletes an event kept on this computer or of a Google calendar you may write to; answers `{}`. */
	const eventDelete = write(
		body => checked(parseEventRef(body), 'Expected { kind: "local", id } or { kind: "google", account, calendarId, eventId } naming an event'),
		async (event): Promise<object> => {
			switch (event.kind) {
				case "local":
					localEvents.apply({ op: "remove", id: event.id });
					return {};
				case "google":
					await google.delete(event.account, event.calendarId, event.eventId);
					return {};
				default: {
					const unhandled: never = event;
					return unhandled;
				}
			}
		},
	);

	return {
		"/api/google": { GET: googleStatus },
		"/api/google/calendars": { PUT: calendarShown },
		"/api/calendar/events": { GET: calendarEvents },
		"/api/calendar/events/new": { PUT: eventCreate },
		"/api/calendar/events/delete": { PUT: eventDelete },
		"/api/calendar/local": { GET: localCalendarEvents },
	};
}

/** Every Gmail account's inbox: their conversations, and the mail, replies, and trashing the Inbox page sends. */
function gmailRoutes({ get, write }: RouteKit, gmail: GmailAccounts): Routes {
	/** `GET /api/gmail/inbox[?fresh]`: each signed-in account and their inboxes' latest conversations, newest first. */
	const inbox = get(params => answer(() => gmail.inbox(params.has("fresh"))));
	/** `GET /api/gmail/thread?account=<account>&id=<id>[&fresh]`: that conversation in full, for the Inbox page's details. */
	const thread = get(params => {
		const account = params.get("account");
		const id = params.get("id");
		return account && id ? answer(() => gmail.thread(account, id, params.has("fresh"))) : fail(400, "Expected ?account= and ?id= naming a Gmail conversation");
	});
	/** `GET /api/gmail/message?account=<account>&thread=<id>&id=<id>`: a message's HTML as a document of its own, which the Inbox page frames. */
	const message = get(async params => {
		const account = params.get("account");
		const threadId = params.get("thread");
		const id = params.get("id");
		if (!account || !threadId || !id) return fail(400, "Expected ?account=, ?thread=, and ?id= naming a Gmail message");
		const html = await gmail.messageHtml(account, threadId, id).catch((err: unknown) => fail(500, errorText(err)));
		if (html instanceof Response) return html;
		return html === undefined ? fail(404, `Conversation ${threadId} holds no HTML message ${id}`) : mailDocument(html);
	});
	const DRAFT = "{ to, cc, bcc } of { name, address } naming someone, html, and text that is not blank";
	/** `PUT /api/gmail/reply`: `MailReply`, sent in its conversation; answers `{}`. */
	const reply = write(
		body => checked(parseMailReply(body), `Expected { account, thread } naming a Gmail conversation, with ${DRAFT}`),
		async input => (await gmail.reply(input), {}),
	);
	/** `PUT /api/gmail/send`: `MailSend`, sent from its account as a new mail; answers `{}`. */
	const send = write(
		body => checked(parseMailSend(body), `Expected { account, subject }, with ${DRAFT}`),
		async input => (await gmail.send(input), {}),
	);
	/** `PUT /api/gmail/trash`: `MailTrash`, moved to Gmail's Trash; answers `{}`. */
	const trash = write(
		body => checked(parseMailTrash(body), "Expected { account, thread } naming a Gmail conversation"),
		async ({ account, thread }) => (await gmail.trash(account, thread), {}),
	);
	return {
		"/api/gmail/inbox": { GET: inbox },
		"/api/gmail/thread": { GET: thread },
		"/api/gmail/message": { GET: message },
		"/api/gmail/reply": { PUT: reply },
		"/api/gmail/send": { PUT: send },
		"/api/gmail/trash": { PUT: trash },
	};
}

/** GitHub pull requests in full: details, stack, options, edits, merges that wait until they are ready, review drafts' preview and post, and their changed files. */
function pullRequestRoutes({ get, write }: RouteKit, env: PullRequestRoutesEnv): Routes {
	/** A read of the pull request `?owner=&repo=&number=` names, refused with `badRequest`. */
	const pullRequestGet = (badRequest: string, read: (pr: PullRequest, params: URLSearchParams) => Promise<Response>): Handler =>
		get(params => {
			const pr = checked(parsePullRequestQuery(params), badRequest);
			return pr instanceof Response ? pr : read(pr, params);
		});

	/** `GET /api/pull-request?owner=<o>&repo=<r>&number=<n>`: that pull request in full, for a pull request's details. */
	const pullRequest = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => loadPullRequestDetail(pr)));

	/** A bare link's PR title, without loading the full details. */
	const pullRequestTitle = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => loadPullRequestTitle(pr)));

	/** `GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>`: the open pull requests stacked with that one, top first, for its details' Stack. */
	const pullRequestStack = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => loadPullRequestStack(pr)));

	/** Images and videos hosted by GitHub; the proxy restricts hosts and keeps the GitHub token off redirected hosts. */
	const githubMedia = get(params => readGithubMedia(params.get("url")));

	/** `PUT /api/pull-request`: `PullRequestEdit`, made on GitHub; answers the pull request in full as it is after it. */
	const pullRequestWrite = write(
		body =>
			checked(
				parsePullRequestEdit(body),
				"Expected { owner, repo, number, change } with a title, description, branch update, label, reviewer, state, review thread, reply, or comment",
			),
		savePullRequest,
	);

	/** `PUT /api/pull-request/viewed`: `PullRequestViewedEdit`, one file marked viewed or not on GitHub; answers `{}`. */
	const pullRequestViewed = write(
		body => checked(parsePullRequestViewedEdit(body), "Expected { owner, repo, number, path, on }"),
		async edit => {
			await markPullRequestFileViewed(edit);
			return {};
		},
	);

	/** `PUT /api/pull-request/attachment`: `PullRequestAttachment`, whose images `gh pr edit --attach` appends to that pull request's description; answers `{}`. */
	const pullRequestAttach = write(
		body =>
			checked(
				parsePullRequestAttachment(body),
				`Expected { owner, repo, number, files } with 1 to ${MAX_PULL_REQUEST_ATTACHMENTS} PNG, JPEG, GIF, WebP, or SVG images, each with a name, alt text, and at most ${MAX_PULL_REQUEST_IMAGE_BYTES / 1024 / 1024} MB in base64`,
			),
		async attachment => {
			await attachToPullRequest(attachment);
			return {};
		},
	);

	/** `GET /api/pull-request/options?owner=<o>&repo=<r>`: the labels and reviewers that repository's pull requests can take. */
	const pullRequestOptions = get(params => {
		const repo = checked(parseRepoQuery(params), "Expected ?owner=&repo=");
		return repo instanceof Response ? repo : answer(() => loadPullRequestOptions(repo));
	});

	const codeRefusal = (err: unknown): Response => fail(err instanceof InvalidPullRequestCommit ? 400 : 500, errorText(err));

	/** `GET /api/pull-request/files`: all changes, or `?commit=<oid>` for one commit of this pull request. */
	const pullRequestFiles = get(async params => {
		const pr = checked(parsePullRequestFilesQuery(params), "Expected ?owner=&repo=&number= and optional commit=<full OID>");
		if (pr instanceof Response) return pr;
		return listPullRequestChanges(pr, pr.commit).then(changes => Response.json(changes)).catch(codeRefusal);
	});

	/** `GET /api/pull-request/file`: a listed path's full diff, optionally scoped to `?commit=<oid>`. */
	const pullRequestFile = get(async params => {
		const pr = checked(parsePullRequestFilesQuery(params), "Expected ?owner=&repo=&number=&path= and optional commit=<full OID>");
		if (pr instanceof Response) return pr;
		const path = params.get("path") ?? "";
		const file = await readPullRequestFile(pr, path, pr.commit).catch(codeRefusal);
		if (file instanceof Response) return file;
		return file ? Response.json(file) : fail(404, `${prKey(pr)} changes no file ${path}`);
	});

	/** `PUT /api/merge-queue`: `MergeQueueChange`, a merge of one pull request or a stack, made at once when GitHub allows it and later otherwise, or its cancel; answers a `MergeQueueAnswer`. */
	const mergeQueue = write(
		body => checked(parseMergeQueueChange(body), `Expected { op: add, method, prs } with 1 to ${MAX_QUEUED_STACK} pull requests, each with a head commit or null, or { op: cancel, id }`),
		env.changeMergeQueue,
		err => fail(409, errorText(err)),
	);

	/** `GET /api/review-draft/preview?owner=<o>&repo=<r>&number=<n>`: the `ReviewPreview` of that pull request's review draft, against its head now. */
	const reviewDraftPreview = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => env.previewReviewDraft(pr)));

	/** `PUT /api/review-draft/post`: `{ owner, repo, number, submit? }`, whose review draft posts as one review; answers the draft marked posted. */
	const reviewDraftPost = write(
		body => checked(parseReviewDraftPost(body), "Expected { owner, repo, number, submit?: { verdict, summary } }"),
		({ pr, submit }) => env.postReviewDraft(pr, submit),
		err => fail(409, errorText(err)),
	);

	return {
		"/api/pull-request": { GET: pullRequest, PUT: pullRequestWrite },
		"/api/github-media": { GET: githubMedia },
		"/api/pull-request/attachment": { PUT: pullRequestAttach },
		"/api/pull-request/viewed": { PUT: pullRequestViewed },
		"/api/merge-queue": { PUT: mergeQueue },
		"/api/review-draft/preview": { GET: reviewDraftPreview },
		"/api/review-draft/post": { PUT: reviewDraftPost },
		"/api/pull-request/title": { GET: pullRequestTitle },
		"/api/pull-request/options": { GET: pullRequestOptions },
		"/api/pull-request/stack": { GET: pullRequestStack },
		"/api/pull-request/files": { GET: pullRequestFiles },
		"/api/pull-request/file": { GET: pullRequestFile },
	};
}

/** Git checkouts and worktrees, the machine's load, the terminal panel's shells, prompt images and documents, and text files. */
function fileRoutes({ get, write }: RouteKit, env: FileRoutesEnv): Routes {
	/**
	 * `GET /api/git?cwd=<dir>`: the git checkout of a directory, `null` outside one, for the new-session draft's branch
	 * picker and a session's header.
	 */
	const git = get(async params => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => gitCheckout(cwd));
	});

	/** `GET /api/worktrees[?cwd=]`: every registered worktree of the repositories sessions ran in, or of the repository containing `cwd`. */
	const worktreeInventory = get(params => answer(() => env.worktrees.inventory(params.get("cwd"))));

	/** `GET /api/worktrees/metrics?repository=&path=`: disk use, last commit, and change counts for one registered checkout. */
	const worktreeMetrics = get((params, req) => {
		const repository = params.get("repository");
		const path = params.get("path");
		if (!repository || !path) return fail(400, "Expected repository and path.");
		return answer(() => env.worktrees.metrics({ repository, path }, req.signal));
	});

	/** `PUT /api/worktrees/removal`: preview a removal, only of merged work when `merged` is set, or remove checkouts whose confirmation still matches. */
	const worktreeRemoval = write(
		body => checked(parseWorktreeRemoval(body), `Expected a preview with targets or removal with confirmed plans, up to ${MAX_WORKTREE_BATCH} worktrees.`),
		async removal => (removal.action === "preview" ? { plans: await env.worktrees.previewAll(removal.targets, removal.merged) } : { results: await env.worktrees.remove(removal.plans) }),
	);

	/** `PUT /api/worktree/release` `{ cwd, branch }`: remove the linked worktree of `cwd`'s repository that has `branch` checked out, unless something keeps it. */
	const branchRelease = write(
		async body => {
			const release = checked(parseBranchRelease(body), "Expected { cwd, branch } with cwd an absolute directory");
			if (release instanceof Response) return release;
			const cwd = await directoryOf(release.cwd);
			return cwd ? { cwd, branch: release.branch } : fail(404, `${release.cwd.trim()} is not a directory.`);
		},
		({ cwd, branch }) => env.worktrees.releaseBranch(cwd, branch),
	);

	const systemLoad = new SystemLoadReader();
	/** `GET /api/system`: the CPU percent since the previous read, the memory available, and the disk space free, for the status bar. */
	const system = get(() => answer(() => systemLoad.read()));
	/** `GET /api/terminals`: the shells the terminal panel runs, oldest first, so a reloaded page reopens their tabs. */
	const terminals = get(() => Response.json(env.terminals.list()));

	/**
	 * `GET /api/image?hash=<sha256>&type=<image type>`: an image of a prompt that omp moved from its session file to its
	 * blob store, served as `type`, one of the prompt image types, since the store keeps no type.
	 */
	const image = get(async params => {
		const hash = params.get("hash") ?? "";
		const type = params.get("type") ?? "";
		if (!SHA256.test(hash) || !PROMPT_IMAGE_TYPES.includes(type)) return fail(400, "Expected ?hash= naming a blob and ?type= naming an image type");
		const file = Bun.file(join(blobsDir, hash));
		if (!(await file.exists())) return fail(404, `No image ${hash}`);
		// The address names the bytes, so they never change.
		return new Response(file, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
	});

	/** `PUT /api/attachment/document`: `PromptDocument`, a file the composer attaches, as omp converts it; answers `{ text }`, or a 422 when omp cannot read it. */
	const promptDocument = write(
		body => checked(parsePromptDocument(body), `Expected { name, data } with a file of at most ${MAX_PROMPT_DOCUMENT_BYTES / 1024 / 1024} MB in base64`),
		async ({ name, data }) => ({ text: await documentText(name, Buffer.from(data, "base64")) }),
		err => (err instanceof UnreadableDocument ? fail(422, err.message) : null),
	);

	/** `GET /api/file?path=<path>`: a text file that agent text names, by an absolute or `~/` path, for the page's file dialog. */
	const textFile = get(async params => {
		const read = await readTextFile(params.get("path") ?? "");
		return read.ok ? Response.json(read.file) : fail(read.status, read.error);
	});

	/**
	 * `GET /api/media?path=<path>`: an image or video that agent text names, by an absolute or `~/` path, served as its
	 * extension's type; Bun answers a `Range` request with its part, so a video seeks. Its own sandbox policy keeps an
	 * SVG opened at this address from running script on the page's origin.
	 */
	const media = get(async params => {
		const found = await findMediaFile(params.get("path") ?? "");
		if (!found.ok) return fail(found.status, found.error);
		return new Response(Bun.file(found.real), {
			headers: {
				"Content-Type": MEDIA_FILE_TYPES[found.extension]!,
				"Content-Security-Policy": "sandbox; default-src 'none'",
				"X-Content-Type-Options": "nosniff",
				// The file may change under the same path, so the browser asks again each time.
				"Cache-Control": "private, no-cache",
			},
		});
	});

	return {
		"/api/git": { GET: git },
		"/api/worktrees": { GET: worktreeInventory },
		"/api/worktrees/metrics": { GET: worktreeMetrics },
		"/api/worktrees/removal": { PUT: worktreeRemoval },
		"/api/worktree/release": { PUT: branchRelease },
		"/api/system": { GET: system },
		"/api/terminals": { GET: terminals },
		"/api/image": { GET: image },
		"/api/attachment/document": { PUT: promptDocument },
		"/api/file": { GET: textFile },
		"/api/media": { GET: media },
	};
}

/** The model providers omp's `/login` signs in to. */
function providerRoutes({ get, write }: RouteKit): Routes {
	const refuse = (err: unknown): Response | null => (err instanceof Rejected ? fail(err.status, err.message) : null);
	return {
		/** Every provider with its stored accounts, and the sign-in the page last started. */
		"/api/providers": { GET: get(() => answer(loadProviders)) },
		/** `{ method }`: starts that `/login` entry, abandoning a sign-in under way. */
		"/api/providers/login": { PUT: write(body => checked(parseLoginMethod(body), "Expected { method } naming a /login provider"), startProviderLogin, refuse) },
		/** `{ prompt, value }`: answers the sign-in's open question; 409 once it no longer waits on it. */
		"/api/providers/login/answer": { PUT: write(body => checked(parseLoginAnswer(body), "Expected { prompt, value }"), answerProviderLogin, refuse) },
		/** Abandons the sign-in under way, or dismisses how the last one ended. */
		"/api/providers/login/cancel": { PUT: write(() => null, cancelProviderLogin) },
		/** `{ provider, credentialId }`: removes that stored credential, as `/logout` does. */
		"/api/providers/sign-out": { PUT: write(body => checked(parseProviderSignOut(body), "Expected { provider, credentialId }"), signOutProvider) },
	};
}

/**
 * **Update dashboard**: `GET /api/dashboard/update` answers `DashboardUpdateStatus` without asking origin; `PUT` with any
 * JSON body fast-forwards the server's checkout, installs when `bun.lock` changed, and answers `DashboardUpdateOutcome`
 * before the server restarts, or 409 with why the checkout stays as it was.
 */
function dashboardRoutes({ get, write }: RouteKit, env: DashboardRoutesEnv): Routes {
	return {
		"/api/dashboard/update": {
			GET: get(() => answer(() => env.status())),
			PUT: write(() => null, () => env.update(), err => (err instanceof UpdateRefused ? fail(409, err.message) : null)),
		},
	};
}

/** Settings › Sync: its settings, and a sync, which answers with its outcome whether it synced, conflicted, or failed. */
function syncRoutes({ get, write }: RouteKit, env: SyncRoutesEnv): Routes {
	return {
		"/api/sync": {
			GET: get(() => answer(async () => env.answer())),
			PUT: write(body => checked(parseSyncSettings(body)), async settings => env.configure(settings)),
		},
		"/api/sync/run": { PUT: write(body => checked(parseSyncRun(body), "Expected { choices }"), choices => env.sync(choices)) },
	};
}

function reviewTriageRoutes({ write }: RouteKit, env: RouteEnv["reviewTriages"]): Routes {
	const refuse = (error: unknown): Response => fail(409, errorText(error));
	const sessionOf = (body: unknown): string | Response => (isObject(body) && isNonEmpty(body.sessionId) && Object.keys(body).length === 1 ? body.sessionId : fail(400, "Expected { sessionId }"));
	const capture = (existingReport: boolean) => async (sessionId: string) => {
		const result = await env.startFromSession(sessionId, existingReport);
		if (!result.ok) throw new Error(result.error);
		return result;
	};
	return {
		"/api/review-triage/apply": { PUT: write(body => checked(parseTriageApply(body), "Expected only { id, revision }"), request => env.apply(request), refuse) },
		"/api/review-triage/session": { PUT: write(sessionOf, capture(true), refuse) },
		"/api/review-triage/start": { PUT: write(sessionOf, capture(false), refuse) },
	};
}

/** Every `/api/*` route, by path and method. */
export function createRoutes(env: RouteEnv): Routes {
	const kit = routeKit(env.guards);
	return {
		...sessionRoutes(kit, env.sessions),
		...integrationRoutes(kit, env.integrations),
		...providerRoutes(kit),
		...calendarRoutes(kit, env.calendar),
		...gmailRoutes(kit, env.gmail),
		...pullRequestRoutes(kit, env.pullRequests),
		...fileRoutes(kit, env.files),
		...todoRoutes(kit, env.todos),
		...dashboardRoutes(kit, env.dashboard),
		...syncRoutes(kit, env.sync),
		...reviewTriageRoutes(kit, env.reviewTriages),
	};
}
