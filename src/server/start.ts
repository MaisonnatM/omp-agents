/** Starting a dashboard session: a new one, a fork of a transcript, or a past session resumed. All three spawn omp the same way. */
import { withPinnedSkill } from "../commands";
import { DashboardSession, type DashboardUpdate } from "../dashboard-session";
import { checkoutDir } from "../git";
import { errorText } from "../json";
import type { RpcLaunch } from "../omp/rpc";
import { directoryOf } from "../paths";
import type { PromptImage, StartRequest, StartResult, View } from "../shared/sessions";
import type { LiveSessions } from "./live-sessions";
import type { ProjectJoin, ProjectLaunch } from "./project-runner";

interface Started {
	session: DashboardSession;
	/** The text of the prompt a fork branched at. */
	prompt: string | null;
	/** A new session's first message, sent once the session is in the registry. */
	first?: { text: string; images: PromptImage[] };
}

type Spawn = (instanceId: string, emit: (update: DashboardUpdate) => void) => Promise<Started>;

export interface StartEnv {
	sessions: LiveSessions;
	/** The file a view reads, or `null` while it is not known. */
	pathFor(view: View): string | null;
	/** The file of past session `sessionId`, or `null` while it is not listed. */
	savedFile(sessionId: string): string | null;
	/** Called once a started session is in the registry. */
	onStarted(): void;
	/** Links todo `todoId` to session `sessionId`, which a new session started for it, and moves a todo not started yet to In Progress. */
	linkTodo(todoId: string, sessionId: string): void;
	/** How a start joins a project: the one `project` names, else the one a resumed session belongs to, else none. */
	projects: { launchFor(request: StartRequest, project: ProjectLaunch | null): ProjectJoin };
}

/** Starts `request`; `project` is the project runner's reason for it, which a page's start never has. */
export type Starter = (request: StartRequest, project: ProjectLaunch | null) => Promise<StartResult>;

/** Runs `start` requests; one ready session per success, none on failure. */
export function createStarter(env: StartEnv): Starter {
	const { sessions } = env;
	/** Past sessions being resumed, so a second click starts no second omp on the same file. */
	const resuming = new Set<string>();

	async function launch(failure: string, spawn: Spawn): Promise<{ started: Started } | { error: string }> {
		const { instanceId, emit } = sessions.allocate();
		try {
			return { started: await spawn(instanceId, emit) };
		} catch (err) {
			return { error: `${failure}: ${errorText(err)}` };
		}
	}

	/** `rpcLaunch` is what a project session launches with; a fork belongs to no project. */
	async function spawnFor(request: StartRequest, rpcLaunch: RpcLaunch): Promise<{ started: Started } | { error: string }> {
		switch (request.kind) {
			case "new": {
				const dir = await directoryOf(request.cwd);
				if (!dir) return { error: `${request.cwd.trim()} is not a directory.` };
				// omp writes a fresh session's file only with its first reply, so a first `!` command would show nowhere.
				if (request.prompt.startsWith("!")) return { error: "Start the session with a prompt. A ! command runs once omp has replied." };
				const { branch, model, thinking, skill, images } = request;
				let cwd = dir;
				if (branch) {
					try {
						cwd = await checkoutDir(dir, branch);
					} catch (err) {
						return { error: `Cannot check out ${branch.name}: ${errorText(err)}` };
					}
				}
				let text: string;
				try {
					text = await withPinnedSkill(cwd, skill, request.prompt);
				} catch (err) {
					return { error: `Cannot read the skills in ${cwd}: ${errorText(err)}` };
				}
				return launch("Cannot start omp", async (id, emit) => ({
					session: await DashboardSession.start(id, cwd, model, thinking, rpcLaunch, emit),
					prompt: null,
					first: { text, images },
				}));
			}
			case "fork": {
				const source = env.pathFor(request.view);
				if (!source) return { error: "Cannot fork: this session's file is not known yet." };
				return launch("Cannot fork", (id, emit) => DashboardSession.fork(id, source, request.entryId, emit));
			}
			case "resume": {
				const { sessionId } = request;
				if (sessions.sessionIds().has(sessionId) || resuming.has(sessionId)) return { error: "This session is already running." };
				const path = env.savedFile(sessionId);
				if (!path) return { error: "Cannot resume: this session's file is not known." };
				resuming.add(sessionId);
				try {
					return await launch("Cannot resume", async (id, emit) => ({ session: await DashboardSession.resume(id, path, rpcLaunch, emit), prompt: null }));
				} finally {
					resuming.delete(sessionId);
				}
			}
		}
	}

	return async (request, project) => {
		const join = env.projects.launchFor(request, project);
		const outcome = await spawnFor(request, join.rpc);
		if ("error" in outcome) return { ok: false, error: outcome.error };
		const { session, prompt, first } = outcome.started;
		// A session whose omp exited since it spawned would stay in the roster with no one to remove it.
		if (!sessions.add(session, request.kind === "new" ? request.subject : null)) return { ok: false, error: "omp exited as the session started." };
		// The todo and the project link first, so the session's first turn already knows the todo it works on and its role.
		if (request.kind === "new" && request.todoId) env.linkTodo(request.todoId, session.sessionId);
		join.attach(session);
		// The new session's first message goes in once it is in the registry, where its events find their view.
		if (first) void session.prompt(null, first.text, first.images, "steer");
		env.onStarted();
		return { ok: true, instanceId: session.instanceId, cwd: session.cwd, prompt };
	};
}
