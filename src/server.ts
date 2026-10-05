/** The dashboard server: wires the registries, the HTTP API, and the socket together, then follows omp's files and registry. */
import type { Server } from "bun";
import { errorText } from "./json";
import { type HostSnapshot, listHosts } from "./omp/collab";
import { ompVersion } from "./omp/install";
import { sessionsDir } from "./omp/sessions";
import { displayPath, interruptedFile, tokenFile, userTodosFile } from "./paths";
import { HOSTNAME, listeningLine, originOf, portFromEnv } from "./server/address";
import { loadToken } from "./server/auth";
import { Broadcasts } from "./server/broadcasts";
import { fail, guardsFor } from "./server/http";
import { InterruptedSessions } from "./server/interrupted";
import { LiveSessions, type SessionUpdate } from "./server/live-sessions";
import { Loops } from "./server/loops";
import { buildPage, servePage } from "./server/page";
import { createRoutes } from "./server/routes";
import { SessionFiles } from "./server/session-files";
import { createClientHandler } from "./server/socket";
import { createStarter } from "./server/start";
import { UserTodosFile } from "./server/user-todos-file";
import { type SocketData, send, Views } from "./server/views";
import { parseClientMsg } from "./server/wire";
import type { View } from "./shared";

const PORT = portFromEnv();

const token = loadToken(tokenFile);
const guards = guardsFor(PORT, token);
const page = await buildPage();
const files = new SessionFiles();
const sessions = new LiveSessions(onLiveUpdate);
const interrupted = new InterruptedSessions(interruptedFile);
const todos = new UserTodosFile(userTodosFile);
/** The file a view reads, or `null` while it is not known (not listed yet, or no such session). */
const pathFor = (view: View): string | null =>
	view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
const views = new Views(pathFor, (topic, msg) => server.publish(topic, JSON.stringify(msg)));
const broadcasts = new Broadcasts({
	rosterMsg: () => ({ t: "roster", hosts: sessions.rows(files.factsOf), error: rosterError }),
	pastMsg: () => ({ t: "past", sessions: files.past(sessions.sessionIds(), id => interrupted.has(id)) }),
	userTodosMsg: () => ({ t: "user-todos", todos: todos.todos }),
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
});
const startSession = createStarter({
	sessions,
	pathFor,
	savedFile: files.pathOf,
	onStarted: () => broadcasts.syncRoster(),
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
		if (todos.apply(change)) broadcasts.pushUserTodos();
		else send(ws, { t: "user-todos", todos: todos.todos });
	},
});

/** Why the last registry listing failed, shown with the roster. */
let rosterError: string | null = null;
/** Whether the registry was listed since the last poll tick found no listener. */
let registryFresh = false;

/** Directories sessions ran in: live ones first, then saved ones newest first. */
const knownCwds = (): string[] => [...new Set([...sessions.cwds(), ...files.cwds()].filter(Boolean))];

/** The session list changed: views may now find their file, and the past list is out of date. */
function onFilesChanged(): void {
	views.sync();
	broadcasts.pushPast();
	// The first scan reads every transcript; the list shows before it finishes.
	void files.linkPullRequests().then(changed => {
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
	sessions.follow(hosts);
	broadcasts.pushAll();
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
				origin: originOf(PORT),
				knownCwds,
				facts: files.facts,
				pullRequestsOf: files.pullRequestsOf,
				onLinked: () => broadcasts.pushAll(),
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
await rescanFiles();
await listRegistry();
loops.start();
console.log(listeningLine(PORT, ompVersion));
console.log(`Sign in at ${originOf(PORT)}/?token=${token}`);
console.log(`The access token is in ${displayPath(tokenFile)}; delete the file and restart to rotate it.`);

/** SIGINT and SIGTERM may both arrive; the second finds the shutdown already under way. */
let shuttingDown: Promise<void> | undefined;
function shutdown(): Promise<void> {
	shuttingDown ??= (async () => {
		await sessions.dispose();
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
