/** The dashboard server: wires the registries, the HTTP API, and the socket together, then follows omp's files and registry. */
import { rmSync } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import { GoogleCalendarReader } from "./google-calendar";
import { loadInbox } from "./inbox";
import { integrationServer } from "./integrations";
import { errorText } from "./json";
import type { LiveSession } from "./live-session";
import { findMcpServer, mcpSignedIn, readWithMcpSignIn } from "./omp/mcp";
import { type HostSnapshot, listHosts } from "./omp/collab";
import { ompVersion } from "./omp/install";
import { installedOmp, latestOmp, updateOmp } from "./omp/release";
import { sessionsDir } from "./omp/sessions";
import { stopStats } from "./omp/stats";
import { calendarsFile, directoryOf, displayPath, interruptedFile, noticesFile, oldGoogleFile, pinsFile, projectsFile, routinesFile, sessionEndInboxDir, serverLockFile, tokenFile, userTodoInboxDir, userTodosFile } from "./paths";
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
import { OwnerLock } from "./server/owner-lock";
import { buildPage, servePage } from "./server/page";
import { createRoutes } from "./server/routes";
import { ACTIVITY_KINDS, Notices, UPDATE_KINDS } from "./server/notices";
import { RoutineRunner } from "./server/routine-runner";
import { CalendarsFile } from "./server/calendars-file";
import { PinsFile } from "./server/pins-file";
import { ProjectsFile } from "./server/projects-file";
import { RoutinesFile } from "./server/routines-file";
import { SessionFiles } from "./server/session-files";
import { endSession } from "./server/session-end";
import { createClientHandler } from "./server/socket";
import { createStarter } from "./server/start";
import { TodoInbox } from "./server/todo-inbox";
import { UserTodosFile } from "./server/user-todos-file";
import { terminalFor, type TerminalSocket, type TerminalSocketData, terminalSocket } from "./server/terminal-socket";
import { type Socket, type SocketData, send, Views } from "./server/views";
import { parseClientMsg } from "./server/wire";
import { modelUpdates, upgradeModel } from "./settings";
import { MCP_SERVICES } from "./shared/accounts";
import { agentOn } from "./shared/moves";
import type { PinChange } from "./shared/pins";
import type { StartRequest, StartResult, View } from "./shared/sessions";
import { waitingOnYou } from "./slack-messages";
import { DONE_KEPT_HOURS, startChanges } from "./user-todos";
import type { UserTodoChange } from "./user-todos-shared";
import { Terminals } from "./terminals";
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
const terminals = new Terminals();
/** Moves todos checked over {@link DONE_KEPT_HOURS} ago to the archive. */
function clearOldDone(): void {
	applyTodo({ op: "clear-done", categoryId: null, before: new Date(Date.now() - DONE_KEPT_HOURS * 3_600_000).toISOString() });
}
/** Which of the servers beside each other, such as a smoke run on another port, runs routines and the todo inbox. */
const ownerLock = new OwnerLock(serverLockFile, PORT);
const inbox = new TodoInbox(userTodoInboxDir, applyTodo, { active: () => ownerLock.held });
const routines = new RoutinesFile(routinesFile);
const projects = new ProjectsFile(projectsFile);
const pins = new PinsFile(pinsFile);
/** Applies `change` to the pins, and sends every socket the pins when they changed; whether they did. */
function applyPinChange(change: PinChange): boolean {
	const changed = pins.apply(change);
	if (changed) broadcasts.pushPins();
	return changed;
}
const notices = new Notices(
	noticesFile,
	{
		latestOmp,
		installedOmp,
		updateOmp,
		modelUpdates,
		upgradeModel,
		inbox: async () => ({ inbox: await loadInbox(knownCwds(), false), agent: agentOn(sessions.rows(files.factsOf)) }),
		async slack() {
			const slack = await findMcpServer(MCP_SERVICES.slack.host);
			return slack && (await mcpSignedIn(slack)) ? waitingOnYou(url => readWithMcpSignIn(slack, url), Date.now()) : [];
		},
		now: Date.now,
	},
	() => broadcasts.pushNotices(),
);
// The calendars' secret addresses an older version kept read them; Google Calendar now reads through omp's sign-in.
rmSync(oldGoogleFile, { force: true });
const calendars = new CalendarsFile(calendarsFile);
const google = new GoogleCalendarReader(async url => readWithMcpSignIn(await integrationServer("google-calendar"), url), () => calendars.hidden);
/** Aborts as the server stops, which stops every routine command still running. */
const stopping = new AbortController();
/** The file a view reads, or `null` while it is not known (not listed yet, or no such session). */
const pathFor = (view: View): string | null =>
	view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
const views = new Views(pathFor, (topic, msg) => server.publish(topic, JSON.stringify(msg)));
const broadcasts = new Broadcasts({
	roster: () => ({ hosts: sessions.rows(files.factsOf), error: rosterError }),
	past: () => files.past(sessions.sessionIds(), id => interrupted.has(id)),
	userTodosMsg: () => ({ t: "user-todos", list: todos.list }),
	routinesMsg: () => ({ t: "routines", routines: routines.routines }),
	projectsMsg: () => {
		const [added, hidden] = [projects.list.added, projects.list.hidden].map(cwds => cwds.map(cwd => ({ cwd, cwdDisplay: displayPath(cwd) })));
		return { t: "projects", list: { added, hidden } };
	},
	pinsMsg: () => ({ t: "pins", sessionIds: pins.sessionIds }),
	noticesMsg: () => ({ t: "notices", list: notices.list }),
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
		if (!claimUnattendedWork()) return;
		clearOldDone();
		await runner.tick();
	},
	onNoticeTick: () => notices.check(UPDATE_KINDS),
	async onActivityTick() {
		if (broadcasts.listening()) await checkActivity();
		else activityFresh = false;
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
/** Ends `session` as **End session** does, then removes the linked worktree it worked in: the one its bash calls last ran in, else its own directory's. */
const endLive = (session: LiveSession): Promise<void> =>
	endSession({ sessionId: session.sessionId, workDir: files.factsOf(session.sessionId).worktree ?? session.cwd, end: () => session.end() }, dir => worktrees.removeCheckout(dir));
const endInbox = new EndInbox(sessionEndInboxDir, {
	async end(sessionId) {
		const session = sessions.bySessionId(sessionId);
		// Every server follows a terminal session, so only the owner acts on its request; a session started here is this server's alone.
		if (!session || (!sessions.started(session.instanceId) && !ownerLock.held)) return false;
		await endLive(session);
		return true;
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
	changePins: change => void applyPinChange(change),
});
const handleClientMsg = createClientHandler({
	sessions,
	views,
	start: startSession,
	async end(instanceId) {
		const session = sessions.get(instanceId);
		if (session) await endLive(session);
	},
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
	changePins(ws, change) {
		if (!applyPinChange(change)) send(ws, { t: "pins", sessionIds: pins.sessionIds });
	},
	runRoutine: id => runner.runNow(id),
	changeNotices: (ids, op) => notices.apply(ids, op),
});

/** Takes over routines and the todo inbox when the server that ran them is gone; whether this server runs them. */
function claimUnattendedWork(): boolean {
	const was = ownerLock.held;
	const owns = ownerLock.acquire();
	if (owns && !was) {
		console.log("omp-agents: this server now runs routines and the todo inbox.");
		// What the server that ran them saved since this one started.
		routines.reload();
		todos.reload();
		broadcasts.pushRoutines();
		broadcasts.pushUserTodos();
		runner.recover();
		void inbox.drain();
	}
	return owns;
}

/** Why the last registry listing failed, shown with the roster. */
let rosterError: string | null = null;
/** Whether the registry was listed since the last poll tick found no listener. */
let registryFresh = false;
/** Whether the activity was checked since the last activity tick found no listener. */
let activityFresh = false;

/** Checks the pull requests and Slack for the bell. */
function checkActivity(): Promise<void> {
	activityFresh = true;
	return notices.check(ACTIVITY_KINDS);
}

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

/** A socket is the dashboard's own, which watches views, or a terminal tab's, which carries one shell. */
type AnySocketData = SocketData | TerminalSocketData;
const isTerminalSocket = (ws: ServerWebSocket<AnySocketData>): ws is TerminalSocket => "terminal" in ws.data;

const NOT_A_WEBSOCKET = (): Response => new Response("expected a websocket", { status: 426 });

function upgrade(req: Request, srv: Server<AnySocketData>): Response | undefined {
	const refused = guards.admitSocket(req);
	if (refused) return refused;
	return srv.upgrade(req, { data: { views: new Map() } }) ? undefined : NOT_A_WEBSOCKET();
}

function upgradeTerminal(req: Request, srv: Server<AnySocketData>): Response | undefined {
	const refused = guards.admitSocket(req);
	if (refused) return refused;
	const params = new URL(req.url).searchParams;
	const terminal = terminalFor(terminals, params);
	if (terminal instanceof Response) return terminal;
	if (srv.upgrade(req, { data: { terminal, detach: null } })) return undefined;
	// A shell this request opened, which no page would ever show.
	if (!params.has("id")) terminal.kill();
	return NOT_A_WEBSOCKET();
}

let server: Server<AnySocketData>;
try {
	server = Bun.serve<AnySocketData>({
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
				setCalendarShown: (id, shown) => calendars.setShown(id, shown),
				addedCwds: () => projects.list.added,
				changeProjects(change) {
					if (projects.apply(change)) broadcasts.pushProjects();
				},
				placeOf(sessionId) {
					const file = files.pathOf(sessionId);
					const saved = files.savedOf(sessionId);
					if (!file || !saved) return null;
					return { file, dir: files.factsOf(sessionId).worktree ?? sessions.bySessionId(sessionId)?.cwd ?? saved.cwd };
				},
				terminals,
			}),
		},
		fetch(req, srv) {
			const { pathname } = new URL(req.url);
			if (pathname === "/ws") return upgrade(req, srv);
			if (pathname === "/ws/terminal") return upgradeTerminal(req, srv);
			if (pathname.startsWith("/api/")) return guards.admit(req) ?? fail(404, `No ${req.method} ${pathname}`);
			return servePage(req, guards, token, page);
		},
		websocket: {
			// A prompt's images travel as base64 in one message: MAX_PROMPT_IMAGE_BYTES of them, a third more as base64.
			maxPayloadLength: 64 * 1024 * 1024,
			open(ws) {
				if (isTerminalSocket(ws)) return terminalSocket.open(ws);
				broadcasts.open(ws as Socket);
				// The registry was not polled while nobody listened; list it now rather than at the next tick.
				if (!registryFresh) void listRegistry();
				if (!activityFresh) void checkActivity();
			},
			message(ws, raw) {
				if (isTerminalSocket(ws)) return terminalSocket.message(ws, raw);
				const msg = parseClientMsg(raw);
				if (msg) handleClientMsg(ws as Socket, msg).catch((err: unknown) => console.error(`omp-agents: ${msg.t} failed: ${errorText(err)}`));
			},
			close(ws) {
				if (isTerminalSocket(ws)) return terminalSocket.close(ws);
				views.watch(ws as Socket, []);
			},
		},
	});
} catch (err) {
	console.error(`omp-agents: cannot listen on ${HOSTNAME}:${PORT}: ${errorText(err)}`);
	console.error("Set PORT to use another port.");
	process.exit(1);
}

loops.watch();
if (ownerLock.acquire()) {
	runner.recover();
} else {
	const owner = ownerLock.holder();
	console.log(`omp-agents: the server on port ${owner?.port ?? "?"} (pid ${owner?.pid ?? "?"}) runs routines and the todo inbox; this one takes over when it exits.`);
}
// Also on a crash or `process.exit`, so a server that exits unannounced leaves no lock; a killed one leaves a stale lock that the next server takes over.
process.on("exit", () => ownerLock.release());
inbox.watch();
endInbox.watch();
await rescanFiles();
await listRegistry();
if (ownerLock.held) clearOldDone();
loops.start();
console.log(listeningLine(PORT, ompVersion));
console.log(`Sign in at ${originOf(PORT)}/?token=${token}`);
console.log(`The access token is in ${displayPath(tokenFile)}; delete the file and restart to rotate it.`);

/** SIGINT and SIGTERM may both arrive; the second finds the shutdown already under way. */
let shuttingDown: Promise<void> | undefined;
function shutdown(): Promise<void> {
	shuttingDown ??= (async () => {
		await sessions.dispose();
		terminals.dispose();
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
