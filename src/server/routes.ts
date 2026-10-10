/**
 * The HTTP API the page reads and writes omp's settings, analytics, pull requests, git checkouts, worktrees,
 * the workspaces Settings adds and hides, the machine's load, the terminal panel's shells, the integrations, Linear tickets and their files, Google Calendar, prompt images, and the text files agent text names through.
 * Every read goes through `get` and every write through `write`; each route group takes only the part of {@link RouteEnv} it reads.
 */
import { join } from "node:path";
import { buildAnalytics, type SessionFacts as AnalyticsSessionFacts } from "../analytics";
import { errorText } from "../json";
import { listSkills } from "../commands";
import { listChanges, readChangedFile, type SessionPlace } from "../changes";
import { gitCheckout } from "../git";
import type { GoogleCalendarReader } from "../google-calendar";
import { loadPullRequests, loadPullRequestDetail } from "../pull-requests";
import { loadIntegrations, saveGoogleClient, saveSlackClient, signOutIntegration, startIntegrationSignIn } from "../integrations";
import { blobsDir } from "../omp/config";
import { connectedModels, connectedRoles, listModels } from "../omp/models";
import { sessionsDir } from "../omp/sessions";
import { readStats } from "../omp/stats";
import { directoryOf } from "../paths";
import { loadPullRequestOptions, savePullRequest } from "../pull-request-edit";
import { listPullRequestChanges, readPullRequestFile } from "../pull-request-files";
import { loadPullRequestStack } from "../pull-request-stack";
import { loadOmpSettings, Rejected, saveOmpFile, saveRouting } from "../settings";
import { attachToTicket, createTicket, loadTeams, loadTicketDetail, loadTicketMedia, loadTicketOptions, loadTickets, saveTicket } from "../tickets";
import { isUploadPath } from "../linear-uploads";
import { ClientConfigError } from "../mcp-clients";
import type { McpIntegration, McpIntegrationId } from "../shared/accounts";
import { isAnalyticsRange } from "../shared/analytics";
import { type PullRequest, prKey, type Repo } from "../shared/github";
import { type ConversationHit, type ConversationSearchAnswer, PROMPT_IMAGE_TYPES } from "../shared/sessions";
import { TICKET_ID } from "../shared/tickets";
import type { WorkspaceChange } from "../shared/workspaces";
import { SystemLoadReader } from "../system-load";
import { readTextFile } from "../text-file";
import type { Terminals } from "../terminals";
import type { Worktrees } from "../worktrees";
import { answer, fail, type Guards } from "./http";
import { listNotes } from "./project-notes";
import { type Parsed, parseCalendarShown, parseGoogleClient, parseIntegrationId, parsePromptDocument, parsePullRequestEdit, parsePullRequestQuery, parseRepoQuery, parseSlackClient, parseTicketAttachment, parseTicketDraft, parseTicketEdit, parseWorkspaceChange, parseWorktreeRemoval, SHA256 } from "./wire";
import { MAX_TICKET_ATTACHMENT_BYTES } from "../shared/tickets";
import { MAX_PROMPT_DOCUMENT_BYTES } from "../shared/prompt-files";
import { documentText, UnreadableDocument } from "../omp/documents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
	savedOf(sessionId: string): AnalyticsSessionFacts | null;
	/** Where session `sessionId` works, for its changes; `null` while its file is not listed. */
	placeOf(sessionId: string): SessionPlace | null;
	/** The pull request list loaded `repo`'s pull requests, which tells which branch heads which PR and so links the sessions that pushed them. */
	learnHeads(repo: Repo, pullRequests: readonly (PullRequest & { head: string })[]): void;
	/** The notes directory of project `id`, or `null` when there is no such project. */
	projectNotesDir(id: string): string | null;
	/** The saved conversations whose prompts or replies hold every word of `query`, the file changed last first. */
	searchConversations(query: string): Promise<ConversationHit[]>;
}

/** What the integration routes read beyond omp's own config: Google Calendar and the calendars it shows. */
export interface IntegrationRoutesEnv {
	google: GoogleCalendarReader;
	/** Show or hide Google calendar `id`'s events on the Calendar page, and save the choice. */
	setCalendarShown(id: string, shown: boolean): void;
}

/** What the file routes read: the registered worktrees and the terminal panel's shells. */
export interface FileRoutesEnv {
	worktrees: Worktrees;
	terminals: Terminals;
}

/** Everything the HTTP API reads, by concern. */
export interface RouteEnv {
	guards: Guards;
	sessions: SessionRoutesEnv;
	integrations: IntegrationRoutesEnv;
	files: FileRoutesEnv;
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

	/** `GET /api/analytics?range=`: omp-stats' request usage and live sync state. */
	const analytics = get(params => {
		const value = params.get("range") ?? "24h";
		return isAnalyticsRange(value)
			? answer(async () => buildAnalytics(value, await readStats(value), sessionsDir, env.savedOf))
			: fail(400, "Unknown analytics range");
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

	/** `GET /api/project-notes?id=<project id>`: the project's notes directory and the Markdown files in it, which the file dialog opens. */
	const projectNotes = get(params => {
		const id = params.get("id") ?? "";
		const dir = env.projectNotesDir(id);
		return dir === null ? fail(404, `No project ${id}`) : answer(async () => ({ dir, notes: await listNotes(dir) }));
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
		"/api/analytics": { GET: analytics },
		"/api/skills": { GET: skills },
		"/api/pull-requests": { GET: pullRequests },
		"/api/workspaces": { PUT: workspaceChange },
		"/api/changes": { GET: changes },
		"/api/changes/file": { GET: changedFile },
		"/api/project-notes": { GET: projectNotes },
		"/api/conversations": { GET: conversations },
	};
}

/** The MCP integrations, Google Calendar, and Linear tickets. */
function integrationRoutes({ get, write }: RouteKit, env: IntegrationRoutesEnv): Routes {
	const { google } = env;

	/** `GET /api/integrations[?fresh]`: where omp stands with each MCP integration's server, and the sign-in the page last started. */
	const integrations = get(params => answer(() => loadIntegrations(params.has("fresh"))));

	/** A write of `{ id }` naming an MCP integration, answered with that integration as `act` leaves it. */
	const integrationWrite = (act: (id: McpIntegrationId) => Promise<McpIntegration>): Handler =>
		write(body => checked(parseIntegrationId(body), "Expected { id } naming an integration"), act);

	/** `PUT /api/integrations/sign-in`: starts a sign-in and answers with its authorization address to open. */
	const integrationSignIn = integrationWrite(startIntegrationSignIn);

	/** `PUT /api/integrations/sign-out`: removes the sign-ins omp manages for the integration's server, as `/mcp unauth` does; its config stays. */
	const integrationSignOut = integrationWrite(signOutIntegration);

	/** `PUT /api/integrations/slack/client`: `{ clientId, clientSecret?, redirectUri, callbackPort, scope }` of your Slack app; a client the MCP config cannot take is a 400. */
	const slackClient = write(body => checked(parseSlackClient(body)), saveSlackClient, err => (err instanceof ClientConfigError ? fail(400, err.message) : null));

	/** `PUT /api/integrations/google-calendar/client`: `{ clientId, clientSecret?, callbackPort }` of your Google OAuth client; a client the MCP config cannot take is a 400. */
	const googleClient = write(body => checked(parseGoogleClient(body)), saveGoogleClient, err => (err instanceof ClientConfigError ? fail(400, err.message) : null));

	/** `GET /api/google[?fresh]`: the calendars checked in your Google Calendar's list, with why each one's last read failed. */
	const googleStatus = get(params => answer(() => google.status(params.has("fresh"))));

	/** `PUT /api/google/calendars` `{ id, shown }`: show or hide one calendar's events on the Calendar page; answers the calendars after it. */
	const calendarShown = write(
		body => checked(parseCalendarShown(body), "Expected { id, shown } naming a calendar"),
		async ({ id, shown }) => {
			env.setCalendarShown(id, shown);
			return google.status();
		},
	);

	/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of your shown Google calendars in that span. */
	const calendarEvents = get(params => {
		const from = new Date(params.get("from") ?? "");
		const to = new Date(params.get("to") ?? "");
		const span = to.getTime() - from.getTime();
		if (!(span > 0 && span <= MAX_EVENT_SPAN_MS)) return fail(400, "Expected ?from= and ?to= ISO times, at most 62 days apart");
		return answer(() => google.events(from, to, params.has("fresh")));
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
		"/api/integrations": { GET: integrations },
		"/api/integrations/sign-in": { PUT: integrationSignIn },
		"/api/integrations/sign-out": { PUT: integrationSignOut },
		"/api/integrations/slack/client": { PUT: slackClient },
		"/api/integrations/google-calendar/client": { PUT: googleClient },
		"/api/google": { GET: googleStatus },
		"/api/google/calendars": { PUT: calendarShown },
		"/api/calendar/events": { GET: calendarEvents },
		"/api/tickets": { GET: tickets },
		"/api/linear/teams": { GET: teams },
		"/api/ticket": { GET: ticket, PUT: ticketWrite },
		"/api/ticket/new": { PUT: ticketCreate },
		"/api/ticket/attachment": { PUT: ticketAttach },
		"/api/ticket/options": { GET: ticketOptions },
		"/api/ticket/media": { GET: ticketMedia },
	};
}

/** GitHub pull requests in full: details, stack, options, edits, and their changed files. */
function pullRequestRoutes({ get, write }: RouteKit): Routes {
	/** A read of the pull request `?owner=&repo=&number=` names, refused with `badRequest`. */
	const pullRequestGet = (badRequest: string, read: (pr: PullRequest, params: URLSearchParams) => Promise<Response>): Handler =>
		get(params => {
			const pr = checked(parsePullRequestQuery(params), badRequest);
			return pr instanceof Response ? pr : read(pr, params);
		});

	/** `GET /api/pull-request?owner=<o>&repo=<r>&number=<n>`: that pull request in full, for a pull request's details. */
	const pullRequest = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => loadPullRequestDetail(pr)));

	/** `GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>`: the open pull requests stacked with that one, top first, for its details' Stack. */
	const pullRequestStack = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => loadPullRequestStack(pr)));

	/** `PUT /api/pull-request`: `PullRequestEdit`, made on GitHub; answers the pull request in full as it is after it. */
	const pullRequestWrite = write(
		body => checked(parsePullRequestEdit(body), "Expected { owner, repo, number, change } with a label or reviewer to add or remove, or a state of open, draft, or closed"),
		savePullRequest,
	);

	/** `GET /api/pull-request/options?owner=<o>&repo=<r>`: the labels and reviewers that repository's pull requests can take. */
	const pullRequestOptions = get(params => {
		const repo = checked(parseRepoQuery(params), "Expected ?owner=&repo=");
		return repo instanceof Response ? repo : answer(() => loadPullRequestOptions(repo));
	});

	/** `GET /api/pull-request/files?owner=<o>&repo=<r>&number=<n>`: every file that pull request changes, read from GitHub anew, for its changes page. */
	const pullRequestFiles = pullRequestGet("Expected ?owner=&repo=&number=", pr => answer(() => listPullRequestChanges(pr)));

	/** `GET /api/pull-request/file?owner=<o>&repo=<r>&number=<n>&path=<path>`: one file of that list in full, with its diff; only a path the list holds. */
	const pullRequestFile = pullRequestGet("Expected ?owner=&repo=&number=&path=", async (pr, params) => {
		const path = params.get("path") ?? "";
		const file = await readPullRequestFile(pr, path).catch((err: unknown) => fail(500, errorText(err)));
		if (file instanceof Response) return file;
		return file ? Response.json(file) : fail(404, `${prKey(pr)} changes no file ${path}`);
	});

	return {
		"/api/pull-request": { GET: pullRequest, PUT: pullRequestWrite },
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

	/** `PUT /api/worktrees/removal`: preview a removal, or remove checkouts whose confirmation still matches. */
	const worktreeRemoval = write(
		body => checked(parseWorktreeRemoval(body), "Expected a preview with targets or removal with confirmed plans, up to 100 worktrees."),
		async removal => (removal.action === "preview" ? { plans: await env.worktrees.previewAll(removal.targets) } : { results: await env.worktrees.remove(removal.plans) }),
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

	return {
		"/api/git": { GET: git },
		"/api/worktrees": { GET: worktreeInventory },
		"/api/worktrees/metrics": { GET: worktreeMetrics },
		"/api/worktrees/removal": { PUT: worktreeRemoval },
		"/api/system": { GET: system },
		"/api/terminals": { GET: terminals },
		"/api/image": { GET: image },
		"/api/attachment/document": { PUT: promptDocument },
		"/api/file": { GET: textFile },
	};
}

/** Every `/api/*` route, by path and method. */
export function createRoutes(env: RouteEnv): Routes {
	const kit = routeKit(env.guards);
	return {
		...sessionRoutes(kit, env.sessions),
		...integrationRoutes(kit, env.integrations),
		...pullRequestRoutes(kit),
		...fileRoutes(kit, env.files),
	};
}
