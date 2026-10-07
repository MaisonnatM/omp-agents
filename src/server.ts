/** The dashboard server: wires the registries, the HTTP API, and the socket together, then follows omp's files and registry. */
import { rmSync } from "node:fs";
import type { Server } from "bun";
import { GoogleCalendarReader } from "./google-calendar";
import { integrationServer } from "./integrations";
import { errorText } from "./json";
import { readWithMcpSignIn } from "./omp/mcp";
import { type HostSnapshot, listHosts } from "./omp/collab";
import { ompVersion } from "./omp/install";
import { sessionsDir } from "./omp/sessions";
import { stopStats } from "./omp/stats";
import { directoryOf, displayPath, interruptedFile, oldGoogleFile, routinesFile, sessionEndInboxDir, tokenFile, userTodoInboxDir, userTodosFile } from "./paths";
import { runShell } from "./proc";
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT } from "./routines";
import { HOSTNAME, listeningLine, originOf, portFromEnv } from "./server/address";
import { loadToken } from "./server/auth";
import { Broadcasts } from "./server/broadcasts";
import { fail, guardsFor } from "./server/http";
import { EndInbox } from "./server/end-inbox";
import { InterruptedSessions } from "./server/interrupted";
import { LiveSessions, type SessionUpdate } from "./server/live-sessions";
import { Loops } from "./server/loops";
import { buildPage, servePage } from "./server/page";
import { createRoutes } from "./server/routes";
import { RoutineRunner } from "./server/routine-runner";
import { RoutinesFile } from "./server/routines-file";
import { SessionFiles } from "./server/session-files";
import { createClientHandler } from "./server/socket";
import { createStarter } from "./server/start";
import { TodoInbox } from "./server/todo-inbox";
import { UserTodosFile } from "./server/user-todos-file";
import { type SocketData, send, Views } from "./server/views";
import { parseClientMsg } from "./server/wire";
import type { StartRequest, StartResult, View } from "./shared/sessions";
import { DONE_KEPT_HOURS, startChanges } from "./user-todos";
import type { UserTodoChange } from "./user-todos-shared";
import { Worktrees } from "./worktrees";

const PORT = portFromEnv();

const token = loadToken(tokenFile);
const guards = guardsFor(PORT, token);
const page = await buildPage();
const files = new SessionFiles();
const sessions = new LiveSessions(onLiveUpdate);
const interrupted = new InterruptedSessions(interruptedFile);
const todos = new UserTodosFile(userTodosFile);
/** Applies `change` to the list, and sends every socket the list when it changed; whether it did. */
function applyTodo(change: UserTodoChange): boolean {
	const changed = todos.apply(change);
	if (changed) broadcasts.pushUserTodos();
	return changed;
}
/** Moves todos checked over {@link DONE_KEPT_HOURS} ago to the archive. */
function clearOldDone(): void {
	applyTodo({ op: "clear-done", categoryId: null, before: new Date(Date.now() - DONE_KEPT_HOURS * 3_600_000).toISOString() });
}
const inbox = new TodoInbox(userTodoInboxDir, applyTodo);
const routines = new RoutinesFile(routinesFile);
// The calendars' secret addresses an older version kept read them; Google Calendar now reads through omp's sign-in.
rmSync(oldGoogleFile, { force: true });
const google = new GoogleCalendarReader(async url => readWithMcpSignIn(await integrationServer("google-calendar"), url));
/** Aborts as the server stops, which stops every routine command still running. */
const stopping = new AbortController();
/** The file a view reads, or `null` while it is not known (not listed yet, or no such session). */
const pathFor = (view: View): string | null =>
	view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
const views = new Views(pathFor, (topic, msg) => server.publish(topic, JSON.stringify(msg)));
const broadcasts = new Broadcasts({
	rosterMsg: () => ({ t: "roster", hosts: sessions.rows(files.factsOf), error: rosterError }),
	past: () => files.past(sessions.sessionIds(), id => interrupted.has(id)),
	userTodosMsg: () => ({ t: "user-todos", list: todos.list }),
	routinesMsg: () => ({ t: "routines", routines: routines.routines }),
	publish: (topic, json) => void server.publish(topic, json),
	subscriberCount: topic => server.subscriberCount(topic),
	beforeRosterPush: () => views.sync(),
	saveRunning: () => interrupted.setRunning(sessions.startedHere()),
});
const loops = new Loops(sessionsDir, {
	async onRegistryTick() {
		if (broadcasts.listening()) await listRegistry();
		else registryFresh = false;
	},
	onFileChange(path) {
		views.poke(path);
		return files.touch(path);
	},
	async onListRefresh() {
		if (await files.refresh()) onFilesChanged();
	},
	onRescanTick: rescanFiles,
	onUsageTick: () => broadcasts.refreshUsage(),
	async onMinuteTick() {
		clearOldDone();
		await runner.tick();
	},
});
/** Directories sessions ran in: live ones first, then saved ones newest first. */
const knownCwds = (): string[] => [...new Set([...sessions.cwds(), ...files.cwds()].filter(Boolean))];
const starter = createStarter({
	sessions,
	pathFor,
	savedFile: files.pathOf,
	onStarted: () => broadcasts.syncRoster(),
	linkTodo(todoId, sessionId) {
		for (const change of startChanges(todos.list, todoId, sessionId, new Date().toISOString())) applyTodo(change);
	},
});
const worktrees = new Worktrees({
	knownCwds,
	activity: () => files.activity(),
	serverCwd: process.cwd(),
	live() {
		return sessions.rows(files.factsOf).map(host => ({
			cwd: host.cwd,
			unknownAgents: host.control.phase !== "live" || host.agents.some(agent => (host.source === "terminal" ? agent.status !== "aborted" : agent.status === "running")),
		}));
	},
});
const startSession = (request: StartRequest): Promise<StartResult> => worktrees.start(() => starter(request), request.kind === "new" && request.branch !== null);
const endInbox = new EndInbox(sessionEndInboxDir, {
	session(sessionId) {
		const session = sessions.bySessionId(sessionId);
		return session ? { workDir: files.factsOf(sessionId).worktree ?? session.cwd, end: () => session.end() } : null;
	},
	async removeWorktree(dir) {
		const result = await worktrees.removeCheckout(dir);
		return result.removed ? null : (result.error ?? result.blockers.map(blocker => blocker.message).join(" "));
	},
});
const runner = new RoutineRunner({
	file: routines,
	start: startSession,
	session(instanceId) {
		const session = sessions.get(instanceId);
		return session ? { status: session.row().status, sessionId: session.sessionId, end: () => session.end() } : null;
	},
	now: Date.now,
	async exec(command, cwd) {
		const dir = directoryOf(cwd);
		if (!dir) throw new Error(`${cwd.trim()} is not a directory.`);
		return runShell(command, dir, { timeoutMs: COMMAND_TIMEOUT_MS, maxOutput: MAX_COMMAND_OUTPUT, signal: stopping.signal });
	},
	onChange: () => broadcasts.pushRoutines(),
});
const handleClientMsg = createClientHandler({
	sessions,
	views,
	start: startSession,
	dismissInterrupted(sessionId) {
		if (interrupted.dismiss(sessionId)) broadcasts.pushPast();
	},
	stoppedMidTurn: sessionId => interrupted.stoppedMidTurn(sessionId),
	changeTodo(ws, change) {
		if (!applyTodo(change)) send(ws, { t: "user-todos", list: todos.list });
	},
	changeRoutine(ws, change) {
		if (routines.apply(change, Date.now())) broadcasts.pushRoutines();
		else send(ws, { t: "routines", routines: routines.routines });
	},
	runRoutine: id => runner.runNow(id),
});

/** Why the last registry listing failed, shown with the roster. */
let rosterError: string | null = null;
/** Whether the registry was listed since the last poll tick found no listener. */
let registryFresh = false;

/** The session list changed: views may now find their file, and the past list is out of date. */
function onFilesChanged(): void {
	views.sync();
	broadcasts.pushPast();
	// The first scan reads every transcript; the list shows before it finishes.
	void files.refreshFacts().then(changed => {
		if (changed) broadcasts.pushAll();
	});
}

/** List every session file again, for the changes the watcher did not report. */
async function rescanFiles(): Promise<void> {
	if (await files.scan()) onFilesChanged();
}

function onLiveUpdate(instanceId: string, update: SessionUpdate): void {
	switch (update.kind) {
		case "roster":
			runner.observe(instanceId);
			broadcasts.rosterChanged();
			return;
		case "event":
			views.applyEvent(instanceId, update.event);
			return;
		case "note":
			views.note(instanceId, update.agentId, update.level, update.text);
			return;
		case "exited": {
			// Only a session this dashboard started reports its exit.
			const sessionId = sessions.get(instanceId)?.sessionId;
			if (sessionId && !update.ended) interrupted.interrupt(sessionId);
			sessions.remove(instanceId);
			broadcasts.syncRoster();
			void loops.listNow();
			return;
		}
		case "written":
			loops.fileChanged(update.path);
			return;
		case "switched":
			// Before the edited prompt's events, so they land in the new file's transcript.
			views.sync();
			broadcasts.syncRoster();
			return;
		default: {
			const unhandled: never = update;
			return unhandled;
		}
	}
}

/** Lists the registry and follows it; its changes reach every socket. */
async function listRegistry(): Promise<void> {
	let hosts: HostSnapshot[];
	try {
		hosts = await listHosts();
		rosterError = null;
	} catch (err) {
		hosts = [];
		rosterError = errorText(err);
	}
	registryFresh = true;
	const joinedOrLeft = sessions.follow(hosts);
	// A terminal session that asked to end before the registry listed it.
	void endInbox.drain();
	// Every listing can change a host's row or the registry error; only a session that joins or leaves changes the past list.
	broadcasts.pushRoster();
	if (joinedOrLeft) broadcasts.pushPast();
}

function upgrade(req: Request, srv: Server<SocketData>): Response | undefined {
	const refused = guards.admitSocket(req);
	if (refused) return refused;
	if (srv.upgrade(req, { data: { views: new Map() } })) return undefined;
	return new Response("expected a websocket", { status: 426 });
}

let server: Server<SocketData>;
try {
	server = Bun.serve<SocketData>({
		hostname: HOSTNAME,
		port: PORT,
		development: false,
		routes: {
			...createRoutes({
				guards,
				knownCwds,
				savedOf: files.savedOf,
				worktrees,
				learnHeads(repo, pullRequests) {
					if (files.facts.learnHeads(repo, pullRequests)) broadcasts.pushAll();
				},
				google,
				placeOf(sessionId) {
					const file = files.pathOf(sessionId);
					const saved = files.savedOf(sessionId);
					if (!file || !saved) return null;
					return { file, dir: files.factsOf(sessionId).worktree ?? sessions.bySessionId(sessionId)?.cwd ?? saved.cwd };
				},
				busyDirs: () =>
					sessions
						.rows(files.factsOf)
						.filter(host => host.status === "working" || host.status === "needs-input")
						.map(host => host.worktree ?? host.cwd),
			}),
		},
		fetch(req, srv) {
			const { pathname } = new URL(req.url);
			if (pathname === "/ws") return upgrade(req, srv);
			if (pathname.startsWith("/api/")) return guards.admit(req) ?? fail(404, `No ${req.method} ${pathname}`);
			return servePage(req, guards, token, page);
		},
		websocket: {
			// A prompt's images travel as base64 in one message: MAX_PROMPT_IMAGE_BYTES of them, a third more as base64.
			maxPayloadLength: 64 * 1024 * 1024,
			open(ws) {
				broadcasts.open(ws);
				// The registry was not polled while nobody listened; list it now rather than at the next tick.
				if (!registryFresh) void listRegistry();
			},
			message(ws, raw) {
				const msg = parseClientMsg(raw);
				if (msg) handleClientMsg(ws, msg).catch((err: unknown) => console.error(`omp-agents: ${msg.t} failed: ${errorText(err)}`));
			},
			close(ws) {
				views.watch(ws, []);
			},
		},
	});
} catch (err) {
	console.error(`omp-agents: cannot listen on ${HOSTNAME}:${PORT}: ${errorText(err)}`);
	console.error("Set PORT to use another port.");
	process.exit(1);
}

loops.watch();
inbox.watch();
endInbox.watch();
await rescanFiles();
await listRegistry();
clearOldDone();
loops.start();
console.log(listeningLine(PORT, ompVersion));
console.log(`Sign in at ${originOf(PORT)}/?token=${token}`);
console.log(`The access token is in ${displayPath(tokenFile)}; delete the file and restart to rotate it.`);

/** SIGINT and SIGTERM may both arrive; the second finds the shutdown already under way. */
let shuttingDown: Promise<void> | undefined;
function shutdown(): Promise<void> {
	shuttingDown ??= (async () => {
		await sessions.dispose();
		stopStats();
		// Last, right before exit, so a stopped command's result is not saved as one stopped at its time limit.
		stopping.abort();
		server.stop(true);
		process.exit(0);
	})();
	return shuttingDown;
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
// The desktop shell holds the server's stdin open and never writes to it; when the shell dies, even by SIGKILL, the pipe ends.
if (process.env.OMP_AGENTS_PARENT === "stdin") {
	process.stdin.on("end", () => void shutdown());
	process.stdin.resume();
}
