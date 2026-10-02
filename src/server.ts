/** The dashboard server: wires the registries, the HTTP API, and the socket together, then follows omp's files and registry. */
import { mkdirSync, watch as watchFiles } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";
import { errorText } from "./json";
import { type HostSnapshot, listHosts } from "./omp/collab";
import { ompVersion } from "./omp/install";
import { sessionsDir } from "./omp/sessions";
import { displayPath, tokenFile } from "./paths";
import { loadToken } from "./server/auth";
import { fail, guardsFor } from "./server/http";
import { LiveSessions, type SessionUpdate } from "./server/live-sessions";
import { buildPage, servePage } from "./server/page";
import { createRoutes } from "./server/routes";
import { SessionFiles } from "./server/session-files";
import { createClientHandler } from "./server/socket";
import { createStarter } from "./server/start";
import { type SocketData, send, Views } from "./server/views";
import { parseClientMsg } from "./server/wire";
import type { ServerMsg, View } from "./shared";
import { fetchPlanUsage } from "./usage";

const PORT = Number(process.env.PORT ?? 4317);
const HOSTNAME = "127.0.0.1";
/** The registry has no change feed; listing it is one local IPC round trip per host. */
const POLL_MS = 1500;
/** Coalesce bursts of subagent progress into one roster push. */
const ROSTER_PUSH_MS = 150;
/** Re-read the session files the watcher reported at most this often while sessions write. */
const LIST_THROTTLE_MS = 500;
/** List every session file this often, in case the watcher missed a change. */
const RESCAN_MS = 60_000;
/** `omp usage` caches provider reports itself; each run still costs a process and up to one network round trip per provider. */
const USAGE_POLL_MS = 60_000;

const token = loadToken(tokenFile);
const guards = guardsFor(PORT, token);
const page = await buildPage();
const files = new SessionFiles();
const sessions = new LiveSessions(onLiveUpdate);
/** The file a view reads, or `null` while it is not known (not listed yet, or no such session). */
const pathFor = (view: View): string | null =>
	view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
const views = new Views(pathFor, (topic, msg) => server.publish(topic, JSON.stringify(msg)));
const startSession = createStarter({
	sessions,
	pathFor,
	savedFile: files.pathOf,
	onStarted() {
		pushRoster();
		pushPast();
	},
});
const handleClientMsg = createClientHandler({ sessions, views, start: startSession });

let rosterError: string | null = null;
let rosterJson = "";
let rosterPush: NodeJS.Timeout | undefined;
let pastJson = "";
let listTimer: NodeJS.Timeout | undefined;
/** Whether the registry was listed since the last poll tick found no listener. */
let registryFresh = false;
/** The last `usage` message, empty until the first `omp usage` run finishes. */
let usageJson = "";

/** Directories sessions ran in: live ones first, then saved ones newest first. */
const knownCwds = (): string[] => [...new Set([...sessions.cwds(), ...files.cwds()].filter(Boolean))];

const rosterMsg = (): ServerMsg => ({ t: "roster", hosts: sessions.rows(files.factsOf), error: rosterError });
const pastMsg = (): ServerMsg => ({ t: "past", sessions: files.past(sessions.sessionIds()) });

/** Whether any socket listens. Pushes, and the work to compare them with the last one, wait for the first. */
const hasSubscribers = (): boolean => server.subscriberCount("roster") > 0;

/** Debounced through {@link ROSTER_PUSH_MS}: a burst of roster updates costs one sync and one push. */
function pushRoster(): void {
	clearTimeout(rosterPush);
	rosterPush = undefined;
	if (!hasSubscribers()) {
		rosterJson = "";
		return;
	}
	// A subagent may have registered for a view that waits on its file.
	views.sync();
	const json = JSON.stringify(rosterMsg());
	if (json === rosterJson) return;
	rosterJson = json;
	server.publish("roster", json);
}

function pushPast(): void {
	if (!hasSubscribers()) {
		pastJson = "";
		return;
	}
	const json = JSON.stringify(pastMsg());
	if (json === pastJson) return;
	pastJson = json;
	server.publish("roster", json);
}

async function pollUsage(): Promise<void> {
	let msg: ServerMsg;
	try {
		msg = { t: "usage", plans: await fetchPlanUsage(), error: null };
	} catch (err) {
		msg = { t: "usage", plans: [], error: errorText(err) };
	}
	const json = JSON.stringify(msg);
	if (json !== usageJson) {
		usageJson = json;
		server.publish("roster", json);
	}
	setTimeout(pollUsage, USAGE_POLL_MS);
}

/** The session list changed: views may now find their file, and the past list is out of date. */
function onFilesChanged(): void {
	views.sync();
	pushPast();
	// The first scan reads every transcript; the list shows before it finishes.
	void files.linkPullRequests().then(changed => {
		if (!changed) return;
		pushPast();
		pushRoster();
	});
}

/** Read again the session files the watcher reported. */
async function refreshFiles(): Promise<void> {
	listTimer = undefined;
	if (await files.refresh()) onFilesChanged();
}

/** List every session file again, for the changes the watcher did not report. */
async function rescanFiles(): Promise<void> {
	if (await files.scan()) onFilesChanged();
}

function onLiveUpdate(instanceId: string, update: SessionUpdate): void {
	switch (update.kind) {
		case "roster":
			// The push also points views at subagent files that registered since.
			rosterPush ??= setTimeout(pushRoster, ROSTER_PUSH_MS);
			return;
		case "event":
			views.applyEvent(instanceId, update.event);
			return;
		case "note":
			views.note(instanceId, update.agentId, update.level, update.text);
			return;
		case "exited":
			sessions.remove(instanceId);
			pushRoster();
			void refreshFiles();
			return;
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
	pushRoster();
	pushPast();
}

/** One tick of the registry poll, which only runs while a socket listens. */
async function pollRegistry(): Promise<void> {
	if (hasSubscribers()) await listRegistry();
	else registryFresh = false;
	setTimeout(pollRegistry, POLL_MS);
}

function onFileChange(path: string): void {
	views.poke(path);
	if (files.touch(path)) listTimer ??= setTimeout(refreshFiles, LIST_THROTTLE_MS);
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
				origin: `http://${HOSTNAME}:${PORT}`,
				knownCwds,
				pullRequestIndex: files.pullRequests,
				pullRequestsOf: files.pullRequestsOf,
				onLinked() {
					pushPast();
					pushRoster();
				},
			}),
		},
		fetch(req, srv) {
			const { pathname } = new URL(req.url);
			if (pathname === "/ws") return upgrade(req, srv);
			if (pathname.startsWith("/api/")) return guards.admit(req) ?? fail(404, `No ${req.method} ${pathname}`);
			return servePage(req, guards, token, page);
		},
		websocket: {
			open(ws) {
				ws.subscribe("roster");
				// The registry was not polled while nobody listened; list it now rather than at the next tick.
				if (!registryFresh) void listRegistry();
				send(ws, rosterMsg());
				send(ws, pastMsg());
				if (usageJson) ws.send(usageJson);
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

// One recursive watcher on omp's sessions directory drives every tail and the past-session list.
mkdirSync(sessionsDir, { recursive: true });
watchFiles(sessionsDir, { recursive: true }, (_event, name) => {
	if (name) onFileChange(join(sessionsDir, String(name)));
});
await rescanFiles();
await listRegistry();
setTimeout(pollRegistry, POLL_MS);
setInterval(() => void rescanFiles(), RESCAN_MS);
void pollUsage();
console.log(`omp-agents (omp v${ompVersion}) on http://${HOSTNAME}:${PORT}`);
console.log(`Sign in at http://${HOSTNAME}:${PORT}/?token=${token}`);
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
