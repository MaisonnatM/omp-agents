/** Starting a dashboard session: a new one, a fork of a transcript, or a past session resumed. All three spawn omp the same way. */
import { withPinnedSkill } from "../commands";
import { DashboardSession, type DashboardUpdate } from "../dashboard-session";
import { checkoutDir } from "../git";
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { PromptImage, StartRequest, StartResult, View } from "../shared";
import type { LiveSessions } from "./live-sessions";

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
	/** Links todo `todoId` to session `sessionId`, which a new session started for it. */
	linkTodo(todoId: string, sessionId: string): void;
}

/** Runs `start` requests; one ready session per success, none on failure. */
export function createStarter(env: StartEnv): (request: StartRequest) => Promise<StartResult> {
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

	async function spawnFor(request: StartRequest): Promise<{ started: Started } | { error: string }> {
		switch (request.kind) {
			case "new": {
				const dir = directoryOf(request.cwd);
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
					session: await DashboardSession.start(id, cwd, model, thinking, emit),
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
					return await launch("Cannot resume", async (id, emit) => ({ session: await DashboardSession.resume(id, path, emit), prompt: null }));
				} finally {
					resuming.delete(sessionId);
				}
			}
		}
	}

	return async request => {
		const outcome = await spawnFor(request);
		if ("error" in outcome) return { ok: false, error: outcome.error };
		const { session, prompt, first } = outcome.started;
		sessions.add(session, request.kind === "new" ? request.subject : null);
		// The new session's first message goes in once it is in the registry, where its events find their view.
		if (first) void session.prompt(null, first.text, first.images, "steer");
		if (request.kind === "new" && request.todoId) env.linkTodo(request.todoId, session.sessionId);
		env.onStarted();
		return { ok: true, instanceId: session.instanceId, cwd: session.cwd, prompt };
	};
}
