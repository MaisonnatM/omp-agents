import { buildAnalytics, foldSessions, withForeignUsage } from "../analytics";
import { buildContextReport } from "../context-sources";
import { readDecisions } from "../decisions";
import { errorText, isObject } from "../json";
import { listSkills } from "../commands";
import { listChanges, readChangedFile, type SessionPlace } from "../changes";
import { loadPullRequests } from "../pull-requests";
import { enableDictation } from "../omp/config";
import { dictationSettings } from "../omp/dictation";
import { connectedModels, connectedRoles, listModels } from "../omp/models";
import { contextIndex } from "../omp/context-index";
import { sessionsDir } from "../omp/sessions";
import { readSessionRows, readStats, windowOf } from "../omp/stats";
import { directoryOf } from "../paths";
import { clearMemory, editMemoryEntry, loadOmpMemory, rebuildMemory, saveMemoryFile } from "../memory";
import { editModelProfile, loadOmpSettings, Rejected, saveAgentSetting, saveOmpFile, saveRouting } from "../settings";
import { answerExtensionApproval, readExtensionContribution, readExtensionOperation, startExtensionChange } from "../extensions";
import { discoverExtensions, loadExtensions } from "../omp/extensions";
import { isAnalyticsRange } from "../shared/analytics";
import type { ConversationSearchAnswer } from "../shared/sessions";
import type { WorkspaceChange } from "../shared/workspaces";
import { answer, checked, fail } from "./http";
import { parseGraphiteToken, parseSourceControlChange, parseTrustChange, parseWorkspaceChange } from "./wire";
import { signInGraphite } from "../source-control";
import type { Handler, RouteKit, Routes, SessionRoutesEnv } from "./route-kit";
import { dirParam } from "./dir-param";

/** Settings, models, skills, analytics, the pull request list, workspaces, and a session's changes. */
export function sessionRoutes({ get, write }: RouteKit, env: SessionRoutesEnv): Routes {
	/**
	 * The `cwd` a request names, `null` when it names none, or the response refusing it. `cwd` must be a
	 * workspace some session counts in or Settings → Workspaces added: the page names workspaces that way, as it names sessions by id.
	 */
	function workspaceCwd(params: URLSearchParams): string | null | Response {
		const cwd = params.get("cwd");
		return cwd === null || env.knownWorkspaces().includes(cwd) || env.addedCwds().includes(cwd) ? cwd : fail(404, `No session ran in ${cwd}`);
	}

	/**
	 * A write whose refusals are `Rejected`: a settings write, `PUT /api/settings/routing`, `/api/settings/model-profiles`,
	 * `/api/settings/agent`, or `/api/settings/file`, `?cwd=` as for reading; and an omp memory edit, `PUT /api/omp-memory/file`, `/entry`, `/clear`,
	 * or `/rebuild`, which need `?cwd=`. The answer is what the write's section loads after it, or the refusal with its status.
	 */
	const settingsWrite = (save: (cwd: string | null, body: unknown) => Promise<unknown>): Handler =>
		write(
			(body, params) => {
				const cwd = workspaceCwd(params);
				return cwd instanceof Response ? cwd : { cwd, body };
			},
			({ cwd, body }) => save(cwd, body),
			(err) => (err instanceof Rejected ? fail(err.status, err.message, err.conflict) : null),
		);
	const settingsRead = (read: (cwd: string | null, params: URLSearchParams) => Promise<unknown> | unknown): Handler =>
		get((params) => {
			const cwd = workspaceCwd(params);
			if (cwd instanceof Response) return cwd;
			return answer(
				async () => read(cwd, params),
				(err) => (err instanceof Rejected ? fail(err.status, err.message, err.conflict) : null),
			);
		});

	/** `GET /api/omp-memory?cwd=<dir>`: what a new session in the workspace gets from omp memory, and the store it comes from. */
	const ompMemory = get(params => {
		const cwd = workspaceCwd(params);
		if (cwd instanceof Response) return cwd;
		return cwd === null ? fail(400, "Expected ?cwd= naming a workspace") : answer(() => loadOmpMemory(cwd));
	});

	/** `GET /api/decisions?cwd=<dir>`: the decision records of a workspace's repository. */
	const decisions = get((params) => {
		const cwd = workspaceCwd(params);
		if (cwd instanceof Response) return cwd;
		return cwd === null ? fail(400, "Expected ?cwd= naming a workspace") : answer(() => readDecisions(cwd));
	});

	/** `GET /api/models`: the models omp lists, for the settings page's pickers. */
	const models = get(() => answer(async () => ({ models: await listModels() })));

	/** `GET /api/models/connected?cwd=<dir>`: the models of the providers you are connected to, for the new-session draft's model picker. */
	const connected = get(async (params) => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => connectedModels(cwd));
	});

	/** `GET /api/models/roles?cwd=<dir>`: omp's model roles a session in that directory could switch to. */
	const roles = get(async (params) => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(async () => ({ roles: await connectedRoles(cwd) }));
	});

	/** `PUT /api/dictation/settings?cwd=<dir>` `{ enabled: true }`: turns dictation on in the user's omp config, then answers the directory's settings as they are after. */
	const dictationEnable = write(
		async (body, params) => (isObject(body) && body.enabled === true ? dirParam(params) : fail(400, "Expected { enabled: true }")),
		async cwd => {
			await enableDictation();
			return dictationSettings(cwd);
		},
	);

	/** `GET /api/analytics?range=`: omp-stats' request usage and live sync state, with Claude Code's and Codex's requests. */
	const analytics = get((params) => {
		const value = params.get("range") ?? "24h";
		if (!isAnalyticsRange(value)) return fail(400, "Unknown analytics range");
		return answer(async () => {
			const [read, foreign] = await Promise.all([readStats(value), env.foreignUsage()]);
			return buildAnalytics(value, withForeignUsage(read, foreign), sessionsDir, env.summaryOf);
		});
	});

	/**
	 * `GET /api/analytics/context?range=[&cwd=<dir>][&session=<id>]`: the context sources over the range, one workspace's or
	 * one session's when named, from the index, which syncs in the background as it answers.
	 */
	const contextReport = get((params) => {
		const range = params.get("range") ?? "24h";
		if (!isAnalyticsRange(range)) return fail(400, "Unknown analytics range");
		return answer(async () => {
			const index = contextIndex();
			index.refresh();
			const rows = index.read(windowOf(range, Date.now()).cutoff);
			return buildContextReport({
				range,
				cwd: params.get("cwd"),
				sessionId: params.get("session"),
				indexing: index.progress,
				...rows,
				root: sessionsDir,
				factsOf: env.summaryOf,
			});
		});
	});

	/** `GET /api/analytics/session?session=<id>`: what that session used over all time, its subagents folded in; `null` before its first request. */
	const sessionUsage = get((params) => {
		const sessionId = params.get("session");
		if (!sessionId) return fail(400, "Expected ?session= naming a session");
		const summary = env.summaryOf(sessionId);
		if (!summary) return fail(404, "No such session");
		return answer(async () => foldSessions(await readSessionRows(summary.file), sessionsDir, env.summaryOf)[0] ?? null);
	});

	/** `GET /api/skills?cwd=<dir>`: the skills a session started in that directory can invoke. */
	const skills = get(async (params) => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(async () => ({ skills: await listSkills(cwd) }));
	});

	/**
	 * `GET /api/pull-requests[?cwd=<dir>][&fresh]`: the pull requests of that workspace's repository, else of every workspace's.
	 * Each answer also tells the pull-request index which branch heads which PR, which links the sessions that pushed them.
	 */
	const pullRequests = get((params) => {
		const cwd = workspaceCwd(params);
		if (cwd instanceof Response) return cwd;
		const fresh = params.has("fresh");
		return answer(async () => {
			const loaded = await loadPullRequests(cwd === null ? env.knownWorkspaces() : [cwd], fresh);
			for (const repo of loaded.repos) if ("pullRequests" in repo) env.learnHeads(repo, repo.pullRequests);
			return loaded;
		});
	});

	/**
	 * `PUT /api/workspaces` `{ op, cwd }` or `{ op: "space", cwd, space }`: add a directory as a workspace, hide or show one,
	 * or place one in the Personal or the Work space; the personal directory is always Personal.
	 */
	const workspaceChange = write(
		async (body): Promise<WorkspaceChange | Response> => {
			const change = checked(parseWorkspaceChange(body), 'Expected { op, cwd } with op add, hide, or show, or { op: "space", cwd, space } with space personal or work');
			if (change instanceof Response) return change;
			if (change.op === "space" && env.spaces().isPersonalDir(change.cwd)) return fail(400, "The personal directory is always in the Personal space.");
			if (change.op !== "add") return change;
			const cwd = await directoryOf(change.cwd);
			return cwd ? { op: "add", cwd } : fail(400, `${change.cwd.trim()} is not a directory.`);
		},
		async (change) => {
			env.changeWorkspaces(change);
			return {};
		},
	);

	/** `PUT /api/project-trust` `{ op: "trust", root, code }` or `{ op: "forget", root }`: trust the pieces the trust dialog listed, or Settings › Workspaces' **Stop trusting**. */
	const trustChange = write(
		(body) => checked(parseTrustChange(body), 'Expected { op: "trust", root, code: [{ id, hash }] } or { op: "forget", root }'),
		async (change) => {
			env.changeProjectTrust(change);
			return {};
		},
	);

	/** `GET /api/source-control`: GitHub's and Graphite's CLIs, the automatic pull setting, and the workspaces' repositories. */
	const sourceControl = get(() => answer(() => env.sourceControl()));

	/** `PUT /api/source-control` `{ op, on, repo? }`: turn automatic pulls on or off by default, or for one repository, or the cleanup after a merge. */
	const sourceControlChange = write(
		(body) =>
			checked(
				parseSourceControlChange(body),
				"Expected { op: default, on }, { op: clean-up, on }, or { op: repo, repo, on } with on true, false, or null for a repository",
			),
		async (change) => {
			env.changeSourceControl(change);
			return env.sourceControl();
		},
	);

	/** `PUT /api/source-control/graphite-sign-in` `{ token }`: signs `gt` in with the token, then answers the same as the `GET`. */
	const graphiteSignIn = write(
		(body) => checked(parseGraphiteToken(body), "Expected { token } holding a Graphite token"),
		async (token) => {
			await signInGraphite(token);
			return env.sourceControl();
		},
	);

	/** The place of the session `?session=` names, or the response refusing it. */
	function sessionPlace(params: URLSearchParams): SessionPlace | Response {
		const sessionId = params.get("session") ?? "";
		return env.placeOf(sessionId) ?? fail(404, `No session ${sessionId}`);
	}

	/** `GET /api/changes?session=<id>`: the files the session's checkout changed against its branch base, and the files its own calls changed. */
	const changes = get((params) => {
		const place = sessionPlace(params);
		return place instanceof Response ? place : answer(() => listChanges(place));
	});

	/** `GET /api/changes/file?session=<id>&path=<path>`: one file of that list in full, with its diff; only a path the list holds. */
	const changedFile = get(async (params) => {
		const place = sessionPlace(params);
		if (place instanceof Response) return place;
		const path = params.get("path") ?? "";
		const file = await readChangedFile(place, path).catch((err: unknown) => fail(500, errorText(err)));
		if (file instanceof Response) return file;
		return file ? Response.json(file) : fail(404, `The session changed no file ${path}`);
	});

	/** `GET /api/conversations?q=<words>`: the saved conversations whose prompts or replies hold every word, each by its latest such message. */
	const conversations = get((params) => {
		const query = params.get("q")?.trim() ?? "";
		return query
			? answer(async (): Promise<ConversationSearchAnswer> => ({ hits: await env.searchConversations(query) }))
			: fail(400, "Expected ?q= with a word to search");
	});

	return {
		"/api/settings": { GET: settingsRead(loadOmpSettings) },
		"/api/settings/routing": { PUT: settingsWrite(saveRouting) },
		"/api/settings/model-profiles": { PUT: settingsWrite(editModelProfile) },
		"/api/settings/agent": { PUT: settingsWrite(saveAgentSetting) },
		"/api/settings/file": { PUT: settingsWrite(saveOmpFile) },
		"/api/settings/extensions": { GET: settingsRead((cwd) => loadExtensions(cwd)), PUT: settingsWrite(async (cwd, body) => startExtensionChange(cwd, body)) },
		"/api/settings/extensions/catalog": {
			GET: settingsRead((cwd, params) =>
				discoverExtensions(cwd, params.get("source") ?? "", params.get("q") ?? "", Math.max(1, Math.min(100, Number(params.get("page")) || 1))),
			),
		},
		"/api/settings/extensions/operation": { GET: settingsRead((cwd, params) => readExtensionOperation(cwd, params.get("id") ?? "")) },
		"/api/settings/extensions/approval": { PUT: settingsWrite(async (cwd, body) => answerExtensionApproval(cwd, body)) },
		"/api/settings/extensions/contribution": { GET: settingsRead((cwd, params) => readExtensionContribution(cwd, Object.fromEntries(params))) },
		"/api/omp-memory": { GET: ompMemory },
		"/api/omp-memory/file": { PUT: settingsWrite(saveMemoryFile) },
		"/api/omp-memory/entry": { PUT: settingsWrite(editMemoryEntry) },
		"/api/omp-memory/clear": { PUT: settingsWrite(clearMemory) },
		"/api/omp-memory/rebuild": { PUT: settingsWrite(rebuildMemory) },
		"/api/decisions": { GET: decisions },
		"/api/models": { GET: models },
		"/api/models/connected": { GET: connected },
		"/api/dictation/settings": { PUT: dictationEnable },
		"/api/models/roles": { GET: roles },
		"/api/analytics": { GET: analytics },
		"/api/analytics/context": { GET: contextReport },
		"/api/analytics/session": { GET: sessionUsage },
		"/api/skills": { GET: skills },
		"/api/pull-requests": { GET: pullRequests },
		"/api/workspaces": { PUT: workspaceChange },
		"/api/project-trust": { PUT: trustChange },
		"/api/source-control": { GET: sourceControl, PUT: sourceControlChange },
		"/api/source-control/graphite-sign-in": { PUT: graphiteSignIn },
		"/api/changes": { GET: changes },
		"/api/changes/file": { GET: changedFile },
		"/api/conversations": { GET: conversations },
	};
}
