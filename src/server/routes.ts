/** The HTTP API the page reads and writes omp's settings, the inbox, and pull requests through. */
import { loadInbox, loadPullRequestDetail } from "../inbox";
import { listModels } from "../omp/models";
import type { PullRequestIndex } from "../pull-requests";
import { linkSessions, type SessionEntry } from "../session-links";
import { loadOmpSettings, saveOmpFile, saveRouting } from "../settings";
import type { LinkedPullRequest } from "../shared";
import { answer, fail, type Guards } from "./http";
import { parsePullRequestQuery, parseSessionLinks } from "./wire";

export interface RouteEnv {
	guards: Guards;
	/** Where this server listens, for the links written into pull request descriptions. */
	origin: string;
	/** Directories sessions ran in: live ones first, then saved ones newest first. */
	knownCwds(): string[];
	pullRequestIndex: PullRequestIndex;
	pullRequestsOf(sessionId: string): LinkedPullRequest[];
	/** The index learned which sessions link to which pull requests. */
	onLinked(): void;
}

type Handler = (req: Request) => Promise<Response>;

export function createRoutes(env: RouteEnv): Record<string, Partial<Record<"GET" | "PUT", Handler>>> {
	const { guards, knownCwds, pullRequestIndex } = env;

	/**
	 * The `cwd` a request names, `null` when it names none, or the response refusing it. `cwd` must be a
	 * directory some session ran in: the page names workspaces that way, as it names sessions by id.
	 */
	function workspaceCwd(req: Request): string | null | Response {
		const cwd = new URL(req.url).searchParams.get("cwd");
		return cwd === null || knownCwds().includes(cwd) ? cwd : fail(404, `No session ran in ${cwd}`);
	}

	/** `GET /api/settings[?cwd=<dir>]`: omp's model routing and files, user-level only without `cwd`. */
	const settings: Handler = async req => {
		const refused = guards.admit(req);
		if (refused) return refused;
		const cwd = workspaceCwd(req);
		return cwd instanceof Response ? cwd : answer(() => loadOmpSettings(cwd));
	};

	/** `GET /api/models`: the models omp lists, for the settings page's pickers. */
	const models: Handler = async req => {
		const refused = guards.admit(req);
		if (refused) return refused;
		return answer(async () => ({ models: await listModels() }));
	};

	/**
	 * `GET /api/inbox[?cwd=<dir>][&fresh]`: the pull requests of that workspace's repository, else of every workspace's.
	 * Each answer also tells the pull-request index which branch heads which PR, which links the sessions that pushed them.
	 */
	const inbox: Handler = async req => {
		const refused = guards.admit(req);
		if (refused) return refused;
		const cwd = workspaceCwd(req);
		if (cwd instanceof Response) return cwd;
		const fresh = new URL(req.url).searchParams.has("fresh");
		return answer(async () => {
			const loaded = await loadInbox(cwd === null ? knownCwds() : [cwd], fresh);
			let linked = false;
			for (const repo of loaded.repos) if ("pullRequests" in repo && pullRequestIndex.learnHeads(repo, repo.pullRequests)) linked = true;
			if (linked) env.onLinked();
			return loaded;
		});
	};

	/** `GET /api/pull-request?owner=<o>&repo=<r>&number=<n>`: that pull request in full, for the inbox's sheet. */
	const pullRequest: Handler = async req => {
		const refused = guards.admit(req);
		if (refused) return refused;
		const pr = parsePullRequestQuery(new URL(req.url).searchParams);
		return pr ? answer(() => loadPullRequestDetail(pr)) : fail(400, "Expected ?owner=&repo=&number=");
	};

	/**
	 * A settings write: `PUT /api/settings/routing` or `/api/settings/file`, `?cwd=` as for reading.
	 * Only this app's own page may write, with a JSON body; the answer is the settings as they load after the write.
	 */
	const settingsWrite =
		(save: (cwd: string | null, body: unknown) => Promise<unknown>): Handler =>
		async req => {
			const write = await guards.writeBody(req);
			if (write instanceof Response) return write;
			const cwd = workspaceCwd(req);
			return cwd instanceof Response ? cwd : answer(() => save(cwd, write.body));
		};

	/**
	 * `PUT /api/pull-request/sessions`: `{ owner, repo, number, sessionIds }`. Writes links to those sessions into the
	 * PR's description on GitHub, each of which must have submitted or worked on that PR. Answers `{ changed }`.
	 */
	const sessionLinks: Handler = async req => {
		const write = await guards.writeBody(req);
		if (write instanceof Response) return write;
		const edit = parseSessionLinks(write.body);
		if (!edit) return fail(400, "Expected { owner, repo, number, sessionIds }");
		const { sessionIds, ...pr } = edit;
		const name = `${pr.owner}/${pr.repo}#${pr.number}`;
		const sessions: SessionEntry[] = [];
		for (const sessionId of new Set(sessionIds)) {
			const linked = env.pullRequestsOf(sessionId).find(other => `${other.owner}/${other.repo}#${other.number}`.toLowerCase() === name.toLowerCase());
			if (!linked) return fail(404, `Session ${sessionId} did not submit or work on ${name}`);
			sessions.push({ sessionId, link: linked.link });
		}
		return answer(() => linkSessions(pr, sessions, env.origin));
	};

	return {
		"/api/settings": { GET: settings },
		"/api/settings/routing": { PUT: settingsWrite(saveRouting) },
		"/api/settings/file": { PUT: settingsWrite(saveOmpFile) },
		"/api/models": { GET: models },
		"/api/pull-request/sessions": { PUT: sessionLinks },
		"/api/inbox": { GET: inbox },
		"/api/pull-request": { GET: pullRequest },
	};
}
