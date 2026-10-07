/**
 * The HTTP API the page reads and writes omp's settings, analytics, the inbox, pull requests, git checkouts,
 * worktrees, the integrations, Linear tickets and their files, Google Calendar, prompt images, and the text files agent text names through.
 */
import { join } from "node:path";
import { buildAnalytics, type SessionFacts as AnalyticsSessionFacts } from "../analytics";
import { errorText } from "../json";
import { listSkills } from "../commands";
import { listChanges, readChangedFile, type SessionPlace } from "../changes";
import { gitCheckout, gitStatus, switchBranch, worktreeAt } from "../git";
import type { GoogleCalendarReader } from "../google-calendar";
import { loadInbox, loadPullRequestDetail } from "../inbox";
import { loadIntegrations, saveGoogleClient, saveSlackClient, signOutIntegration, startIntegrationSignIn } from "../integrations";
import { blobsDir } from "../omp/config";
import { connectedModels, connectedRoles, listModels } from "../omp/models";
import { sessionsDir } from "../omp/sessions";
import { readStats } from "../omp/stats";
import { directoryOf } from "../paths";
import { listPullRequestChanges, readPullRequestFile } from "../pull-request-files";
import { loadOmpSettings, Rejected, saveOmpFile, saveRouting } from "../settings";
import { attachToTicket, createTicket, loadTeams, loadTicketDetail, loadTicketMedia, loadTicketOptions, loadTickets, saveTicket } from "../tickets";
import { isUploadPath } from "../linear-uploads";
import { ClientConfigError } from "../omp/mcp";
import type { McpIntegration, McpIntegrationId } from "../shared/accounts";
import { isAnalyticsRange } from "../shared/analytics";
import { type PullRequest, prKey, type Repo } from "../shared/github";
import { PROMPT_IMAGE_TYPES } from "../shared/sessions";
import { TICKET_ID } from "../shared/tickets";
import { readTextFile } from "../text-file";
import type { Worktrees } from "../worktrees";
import { answer, fail, type Guards } from "./http";
import { parseBranchSwitch, parseGoogleClient, parseIntegrationId, parsePullRequestQuery, parseSlackClient, parseTicketAttachment, parseTicketDraft, parseTicketEdit, parseWorktreeRemoval, SHA256 } from "./wire";
import { MAX_TICKET_ATTACHMENT_BYTES } from "../shared/tickets";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest span `GET /api/calendar/events` reads: a month view's six weeks, with room to spare. */
const MAX_EVENT_SPAN_MS = 62 * 86_400_000;

export interface RouteEnv {
	guards: Guards;
	/** Directories sessions ran in: live ones first, then saved ones newest first. */
	knownCwds(): string[];
	worktrees: Worktrees;
	/** The listed file of a session, for Analytics' title and working directory. */
	savedOf(sessionId: string): AnalyticsSessionFacts | null;
	/** The inbox listed `repo`'s pull requests, which tells which branch heads which PR and so links the sessions that pushed them. */
	learnHeads(repo: Repo, pullRequests: readonly (PullRequest & { head: string })[]): void;
	google: GoogleCalendarReader;
	/** Where session `sessionId` works, for its changes; `null` while its file is not listed. */
	placeOf(sessionId: string): SessionPlace | null;
	/** The directories that live sessions whose turn runs, or waits on a question, work in: each one's worktree, else its cwd. */
	busyDirs(): string[];
}

type Handler = (req: Request) => Promise<Response>;

export function createRoutes(env: RouteEnv): Record<string, Partial<Record<"GET" | "PUT", Handler>>> {
	const { guards, knownCwds, google } = env;

	/** A read: admitted like every other, then handed the request's query. */
	const get =
		(handle: (params: URLSearchParams, req: Request) => Response | Promise<Response>): Handler =>
		async req =>
			guards.admit(req) ?? handle(new URL(req.url).searchParams, req);

	/**
	 * The `cwd` a request names, `null` when it names none, or the response refusing it. `cwd` must be a
	 * directory some session ran in: the page names workspaces that way, as it names sessions by id.
	 */
	function workspaceCwd(params: URLSearchParams): string | null | Response {
		const cwd = params.get("cwd");
		return cwd === null || knownCwds().includes(cwd) ? cwd : fail(404, `No session ran in ${cwd}`);
	}

	/** The directory `?cwd=` names, or the response refusing it. Like a new session, `cwd` may name any directory. */
	const dirParam = (params: URLSearchParams): string | Response => directoryOf(params.get("cwd") ?? "") ?? fail(404, "Expected ?cwd= naming a directory");

	/** `GET /api/settings[?cwd=<dir>]`: omp's model routing and files, user-level only without `cwd`. */
	const settings = get(params => {
		const cwd = workspaceCwd(params);
		return cwd instanceof Response ? cwd : answer(() => loadOmpSettings(cwd));
	});

	/** `GET /api/models`: the models omp lists, for the settings page's pickers. */
	const models = get(() => answer(async () => ({ models: await listModels() })));

	/** `GET /api/models/connected?cwd=<dir>`: the models of the providers you are connected to, for the new-session draft's model picker. */
	const connected = get(params => {
		const cwd = dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => connectedModels(cwd));
	});

	/** `GET /api/models/roles?cwd=<dir>`: omp's model roles a session in that directory could switch to. */
	const roles = get(params => {
		const cwd = dirParam(params);
		return cwd instanceof Response ? cwd : answer(async () => ({ roles: await connectedRoles(cwd) }));
	});

	/** `GET /api/analytics?range=`: omp-stats' request usage and live sync state. */
	const analytics = get(params => {
		const value = params.get("range") ?? "7d";
		return isAnalyticsRange(value)
			? answer(async () => buildAnalytics(value, await readStats(value), sessionsDir, env.savedOf))
			: fail(400, "Unknown analytics range");
	});

	/** `GET /api/skills?cwd=<dir>`: the skills a session started in that directory can invoke. */
	const skills = get(params => {
		const cwd = dirParam(params);
		return cwd instanceof Response ? cwd : answer(async () => ({ skills: await listSkills(cwd) }));
	});

	/**
	 * `GET /api/inbox[?cwd=<dir>][&fresh]`: the pull requests of that workspace's repository, else of every workspace's.
	 * Each answer also tells the pull-request index which branch heads which PR, which links the sessions that pushed them.
	 */
	const inbox = get(params => {
		const cwd = workspaceCwd(params);
		if (cwd instanceof Response) return cwd;
		const fresh = params.has("fresh");
		return answer(async () => {
			const loaded = await loadInbox(cwd === null ? knownCwds() : [cwd], fresh);
			for (const repo of loaded.repos) if ("pullRequests" in repo) env.learnHeads(repo, repo.pullRequests);
			return loaded;
		});
	});

	/** `GET /api/tickets[?fresh]`: the viewer's assigned Linear issues, or why they could not be read. */
	const tickets = get(params => answer(() => loadTickets(params.has("fresh"))));

	/** `GET /api/integrations[?fresh]`: where omp stands with each MCP integration's server, and the sign-in the page last started. */
	const integrations = get(params => answer(() => loadIntegrations(params.has("fresh"))));

	/** A write of `{ id }` naming an MCP integration, answered with that integration as `act` leaves it. */
	const integrationWrite =
		(act: (id: McpIntegrationId) => Promise<McpIntegration>): Handler =>
		async req => {
			const write = await guards.writeBody(req);
			if (write instanceof Response) return write;
			const id = parseIntegrationId(write.body);
			return id ? answer(() => act(id)) : fail(400, "Expected { id } naming an integration");
		};

	/** `PUT /api/integrations/sign-in`: starts a sign-in and answers with its authorization address to open. */
	const integrationSignIn = integrationWrite(startIntegrationSignIn);

	/** `PUT /api/integrations/sign-out`: removes the sign-ins omp manages for the integration's server, as `/mcp unauth` does; its config stays. */
	const integrationSignOut = integrationWrite(signOutIntegration);

	const slackClient: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const parsed = parseSlackClient(write.body);
		if ("error" in parsed) return fail(400, parsed.error);
		return answer(() => saveSlackClient(parsed.ok), err => (err instanceof ClientConfigError ? fail(400, err.message) : null));
	};

	/** `PUT /api/integrations/google-calendar/client`: `{ clientId, clientSecret?, callbackPort }` of your Google OAuth client. */
	const googleClient: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const parsed = parseGoogleClient(write.body);
		if ("error" in parsed) return fail(400, parsed.error);
		return answer(() => saveGoogleClient(parsed.ok), err => (err instanceof ClientConfigError ? fail(400, err.message) : null));
	};

	/** `GET /api/google[?fresh]`: the calendars checked in your Google Calendar's list, with why each one's last read failed. */
	const googleStatus = get(params => answer(() => google.status(params.has("fresh"))));

	/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of your shown Google calendars in that span. */
	const calendarEvents = get(params => {
		const from = new Date(params.get("from") ?? "");
		const to = new Date(params.get("to") ?? "");
		const span = to.getTime() - from.getTime();
		if (!(span > 0 && span <= MAX_EVENT_SPAN_MS)) return fail(400, "Expected ?from= and ?to= ISO times, at most 62 days apart");
		return answer(() => google.events(from, to, params.has("fresh")));
	});

	/** `GET /api/ticket?id=<identifier>`: that Linear issue in full, for the tickets page's main content. */
	const ticket = get(params => {
		const id = params.get("id") ?? "";
		return TICKET_ID.test(id) ? answer(() => loadTicketDetail(id)) : fail(400, "Expected ?id= naming a Linear issue, such as ENG-123");
	});

	/** `PUT /api/ticket`: `TicketEdit`, applied in Linear; answers the issue in full as it is after it. */
	const ticketWrite: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const edit = parseTicketEdit(write.body);
		return edit ? answer(() => saveTicket(edit)) : fail(400, "Expected { id } naming a Linear issue and at least one field to change");
	};

	/** `PUT /api/ticket/new`: `TicketDraft`, opened in Linear; answers `{ identifier }`. */
	const ticketCreate: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const draft = parseTicketDraft(write.body);
		return draft ? answer(() => createTicket(draft)) : fail(400, "Expected { title, description, team } naming a Linear team by id, and fields of their own types");
	};

	/** `PUT /api/ticket/attachment`: `TicketAttachmentUpload`, attached to the issue in Linear; answers `{}`. */
	const ticketAttach: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const upload = parseTicketAttachment(write.body);
		return upload
			? answer(async () => {
					await attachToTicket(upload);
					return {};
				})
			: fail(400, `Expected { issue, name, type, data } naming a Linear issue, with a file of at most ${MAX_TICKET_ATTACHMENT_BYTES / 1024 / 1024} MB in base64`);
	};

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

	/** `GET /api/pull-request?owner=<o>&repo=<r>&number=<n>`: that pull request in full, for the inbox's details. */
	const pullRequest = get(params => {
		const pr = parsePullRequestQuery(params);
		return pr ? answer(() => loadPullRequestDetail(pr)) : fail(400, "Expected ?owner=&repo=&number=");
	});

	/** `GET /api/pull-request/files?owner=<o>&repo=<r>&number=<n>`: every file that pull request changes, read from GitHub anew, for its changes page. */
	const pullRequestFiles = get(params => {
		const pr = parsePullRequestQuery(params);
		return pr ? answer(() => listPullRequestChanges(pr)) : fail(400, "Expected ?owner=&repo=&number=");
	});

	/** `GET /api/pull-request/file?owner=<o>&repo=<r>&number=<n>&path=<path>`: one file of that list in full, with its diff; only a path the list holds. */
	const pullRequestFile = get(async params => {
		const pr = parsePullRequestQuery(params);
		if (!pr) return fail(400, "Expected ?owner=&repo=&number=&path=");
		const path = params.get("path") ?? "";
		const file = await readPullRequestFile(pr, path).catch((err: unknown) => fail(500, errorText(err)));
		if (file instanceof Response) return file;
		return file ? Response.json(file) : fail(404, `${prKey(pr)} changes no file ${path}`);
	});

	/**
	 * `GET /api/git?cwd=<dir>`: the git checkout of a directory, `null` outside one, for the new-session draft's branch
	 * picker and a session's header.
	 */
	const git = get(params => {
		const cwd = dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => gitCheckout(cwd));
	});

	/** `GET /api/git/status?cwd=<dir>`: the branch, upstream, and uncommitted files of a directory's checkout, `null` outside one, for the status bar. */
	const status = get(params => {
		const cwd = dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => gitStatus(cwd));
	});

	/**
	 * `PUT /api/git/switch`: `{ cwd, choice }` switches the checkout `cwd` is in to an existing branch or a new one, and
	 * answers its status. Refused while a session's turn runs in that checkout, and with git's reason when git refuses.
	 */
	const branchSwitch: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const body = parseBranchSwitch(write.body);
		const cwd = body && directoryOf(body.cwd);
		if (!body || !cwd) return fail(400, "Expected { cwd, choice } naming a directory and a branch");
		const target = await worktreeAt(cwd);
		if (!target) return fail(404, `${cwd} is not in a git checkout`);
		const busy = await Promise.all(env.busyDirs().map(dir => worktreeAt(dir)));
		if (busy.some(at => at?.top === target.top)) return fail(409, "A session's turn runs in this checkout; switch once it ends.");
		return answer(async () => {
			await switchBranch(target.top, body.choice);
			return gitStatus(target.top);
		}, err => fail(409, errorText(err)));
	};

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

	/** `GET /api/file?path=<path>`: a text file that agent text names, by an absolute or `~/` path, for the page's file dialog. */
	const textFile = get(async params => {
		const read = await readTextFile(params.get("path") ?? "");
		return read.ok ? Response.json(read.file) : fail(read.status, read.error);
	});

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

	/**
	 * A settings write: `PUT /api/settings/routing` or `/api/settings/file`, `?cwd=` as for reading.
	 * Only this app's own page may write, with a JSON body; the answer is the settings as they load after the write,
	 * or the edit's refusal with its status.
	 */
	const settingsWrite =
		(save: (cwd: string | null, body: unknown) => Promise<unknown>): Handler =>
		async req => {
			const write = await guards.writeBody(req);
			if (write instanceof Response) return write;
			const cwd = workspaceCwd(new URL(req.url).searchParams);
			if (cwd instanceof Response) return cwd;
			return answer(
				() => save(cwd, write.body),
				err => (err instanceof Rejected ? fail(err.status, err.message, err.conflict) : null),
			);
		};

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
	const worktreeRemoval: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const body = parseWorktreeRemoval(write.body);
		if (!body) return fail(400, "Expected a preview with targets or removal with confirmed plans, up to 100 worktrees.");
		if (body.action === "preview") {
			return answer(async () => {
				const plans = [];
				for (const target of body.targets) plans.push(await env.worktrees.preview(target));
				return { plans };
			});
		}
		return answer(async () => ({ results: await env.worktrees.remove(body.plans) }));
	};

	return {
		"/api/settings": { GET: settings },
		"/api/settings/routing": { PUT: settingsWrite(saveRouting) },
		"/api/settings/file": { PUT: settingsWrite(saveOmpFile) },
		"/api/models": { GET: models },
		"/api/models/connected": { GET: connected },
		"/api/models/roles": { GET: roles },
		"/api/analytics": { GET: analytics },
		"/api/skills": { GET: skills },
		"/api/inbox": { GET: inbox },
		"/api/tickets": { GET: tickets },
		"/api/integrations": { GET: integrations },
		"/api/integrations/sign-in": { PUT: integrationSignIn },
		"/api/integrations/sign-out": { PUT: integrationSignOut },
		"/api/integrations/slack/client": { PUT: slackClient },
		"/api/integrations/google-calendar/client": { PUT: googleClient },
		"/api/google": { GET: googleStatus },
		"/api/calendar/events": { GET: calendarEvents },
		"/api/linear/teams": { GET: teams },
		"/api/ticket": { GET: ticket, PUT: ticketWrite },
		"/api/ticket/new": { PUT: ticketCreate },
		"/api/ticket/attachment": { PUT: ticketAttach },
		"/api/ticket/options": { GET: ticketOptions },
		"/api/ticket/media": { GET: ticketMedia },
		"/api/pull-request": { GET: pullRequest },
		"/api/pull-request/files": { GET: pullRequestFiles },
		"/api/pull-request/file": { GET: pullRequestFile },
		"/api/worktrees": { GET: worktreeInventory },
		"/api/worktrees/metrics": { GET: worktreeMetrics },
		"/api/worktrees/removal": { PUT: worktreeRemoval },
		"/api/git": { GET: git },
		"/api/git/status": { GET: status },
		"/api/git/switch": { PUT: branchSwitch },
		"/api/image": { GET: image },
		"/api/file": { GET: textFile },
		"/api/changes": { GET: changes },
		"/api/changes/file": { GET: changedFile },
	};
}
