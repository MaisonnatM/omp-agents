import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Server, ServerWebSocket, Subprocess } from "bun";
import index from "../web/index.html";
import { type GuestUpdate, SessionGuest } from "./guest";
import { type HostSnapshot, listHosts, listSavedSessions, ompCommand, ompVersion, type SavedSession } from "./omp";
import type {
	ClientMsg,
	HostStatus,
	Item,
	LaunchResult,
	LiveView,
	PastView,
	RosterHost,
	ServerMsg,
	View,
} from "./shared";
import { isObject, Transcript } from "./transcript";

const PORT = Number(process.env.PORT ?? 4317);
const HOSTNAME = "127.0.0.1";
const POLL_MS = 1500;
/** Wait this long before rejoining a host whose room dropped us while it stays listed. */
const REJOIN_MS = 5000;
/** Coalesce bursts of subagent progress into one roster push. */
const ROSTER_PUSH_MS = 150;
/** How long a new session gets to publish itself to the registry before the dashboard kills it. */
const LAUNCH_TIMEOUT_MS = 30_000;
const HOME = homedir();
/** Only pages served by this app may open the socket: it carries full control of every session. */
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

interface SocketData {
	view: View | null;
}
type Socket = ServerWebSocket<SocketData>;

let hosts: HostSnapshot[] = [];
let rosterError: string | null = null;
let rosterJson = "";
let rosterPush: NodeJS.Timeout | undefined;
/** Session files on disk, newest first. The page lists the ones without a live host. */
let saved: SavedSession[] = [];
let pastJson = "";
/** One guest per listed host, so every session's subagents are known without opening it. */
const guests = new Map<string, SessionGuest>();
/**
 * omp processes this dashboard started, by pid. Each runs its TUI in a pseudo-terminal
 * that nobody reads, so it lives only as long as the dashboard.
 */
const owned = new Map<number, Subprocess>();
/** Started sessions not listed yet, by pid, with the socket that asked for them. */
const launches = new Map<number, { ws: Socket; deadline: number }>();

const phaseTopic = (instanceId: string): string => `phase:${instanceId}`;
const itemsTopic = (view: LiveView): string => `items:${view.instanceId}:${view.agentId ?? ""}`;
const send = (ws: Socket, msg: ServerMsg): void => void ws.send(JSON.stringify(msg));
const publish = (topic: string, msg: ServerMsg): void => void server.publish(topic, JSON.stringify(msg));
const displayPath = (path: string): string =>
	path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;

function statusOf(host: HostSnapshot): HostStatus {
	if (host.inputRequired) return "needs-input";
	if (host.busy === null) return "unknown";
	return host.busy ? "working" : "idle";
}

function toRosterHost(host: HostSnapshot): RosterHost {
	return {
		instanceId: host.instanceId,
		generation: host.generation,
		pid: host.pid,
		sessionId: host.sessionId,
		sessionName: host.sessionName,
		cwd: host.cwd,
		cwdDisplay: displayPath(host.cwd),
		model: host.model ? `${host.model.provider}/${host.model.id}` : null,
		startedAt: host.startedAt,
		participants: host.participants,
		relayConnected: host.relayConnected,
		status: statusOf(host),
		access: host.access,
		owned: owned.has(host.pid),
		agents: guests.get(host.instanceId)?.agents() ?? [],
	};
}

function rosterMsg(): ServerMsg {
	return { t: "roster", hosts: hosts.map(toRosterHost), error: rosterError };
}

function pastMsg(): ServerMsg {
	const live = new Set(hosts.map(host => host.sessionId));
	const sessions = saved
		.filter(session => !live.has(session.id))
		.map(session => ({
			sessionId: session.id,
			title: session.title,
			cwd: session.cwd,
			cwdDisplay: displayPath(session.cwd),
			modifiedAt: session.modifiedAt,
		}));
	return { t: "past", sessions };
}

function pushRoster(): void {
	clearTimeout(rosterPush);
	rosterPush = undefined;
	const json = JSON.stringify(rosterMsg());
	if (json === rosterJson) return;
	rosterJson = json;
	server.publish("roster", json);
}

function pushPast(): void {
	const json = JSON.stringify(pastMsg());
	if (json === pastJson) return;
	pastJson = json;
	server.publish("roster", json);
}

function onGuestUpdate(instanceId: string, update: GuestUpdate): void {
	switch (update.kind) {
		case "phase":
			publish(phaseTopic(instanceId), { t: "phase", instanceId, phase: update.phase });
			return;
		case "items": {
			const view: LiveView = { kind: "live", instanceId, agentId: update.agentId };
			publish(itemsTopic(view), { t: "items", view, reset: update.reset, items: update.items });
			return;
		}
		case "agents":
			rosterPush ??= setTimeout(pushRoster, ROSTER_PUSH_MS);
			return;
	}
}

function spawnGuest(host: HostSnapshot): SessionGuest {
	const guest = new SessionGuest(toRosterHost(host), update => onGuestUpdate(host.instanceId, update));
	guests.set(host.instanceId, guest);
	for (const ws of watchers(host.instanceId)) openAgentFor(ws);
	return guest;
}

/** Follow the registry: join new hosts, drop vanished ones, rejoin rotated or dropped rooms. */
function reconcileGuests(): void {
	const listed = new Map(hosts.map(host => [host.instanceId, host]));
	for (const [instanceId, guest] of guests) {
		const host = listed.get(instanceId);
		if (!host) {
			guest.end("This session is no longer running.");
			guests.delete(instanceId);
		} else if (guest.generation !== null && guest.generation !== host.generation) {
			guest.end("The session switched rooms; rejoining.");
			guests.delete(instanceId);
		} else if (guest.endedAt !== null && Date.now() - guest.endedAt > REJOIN_MS) {
			guests.delete(instanceId);
		}
	}
	for (const host of hosts) if (!guests.has(host.instanceId)) spawnGuest(host);
}

async function pollRoster(): Promise<void> {
	try {
		hosts = await listHosts();
		rosterError = null;
	} catch (err) {
		hosts = [];
		rosterError = err instanceof Error ? err.message : String(err);
	}
	saved = await listSavedSessions();
	settleLaunches();
	reconcileGuests();
	pushRoster();
	pushPast();
	setTimeout(pollRoster, POLL_MS);
}

function settleLaunch(pid: number, result: LaunchResult): void {
	const launch = launches.get(pid);
	if (!launch) return;
	launches.delete(pid);
	send(launch.ws, { t: "created", result });
}

/** A launch succeeds when the registry lists a host with its pid, and fails when it is not listed in time. */
function settleLaunches(): void {
	for (const [pid, { deadline }] of launches) {
		const host = hosts.find(h => h.pid === pid);
		if (host) {
			settleLaunch(pid, { ok: true, instanceId: host.instanceId });
		} else if (Date.now() > deadline) {
			settleLaunch(pid, {
				ok: false,
				error: `The session did not appear in the Collab registry within ${LAUNCH_TIMEOUT_MS / 1000} seconds. Check that collab.autoStart is control.`,
			});
			owned.get(pid)?.kill();
		}
	}
}

/** Start `omp` in `input` (absolute, `~`-relative, or relative to the home directory). */
function launch(ws: Socket, input: string): void {
	const raw = input.trim();
	const cwd = raw === "~" || raw.startsWith("~/") ? join(HOME, raw.slice(1)) : resolve(HOME, raw);
	try {
		if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
	} catch {
		send(ws, { t: "created", result: { ok: false, error: `${raw} is not a directory.` } });
		return;
	}
	let proc: Subprocess;
	try {
		// omp hosts a Collab room only in interactive mode, which needs a terminal. The PTY must be drained.
		proc = Bun.spawn(ompCommand, { cwd, terminal: { data() {} } });
	} catch (err) {
		send(ws, { t: "created", result: { ok: false, error: `Cannot start omp: ${err instanceof Error ? err.message : String(err)}` } });
		return;
	}
	const pid = proc.pid;
	owned.set(pid, proc);
	launches.set(pid, { ws, deadline: Date.now() + LAUNCH_TIMEOUT_MS });
	void proc.exited.then(code => {
		owned.delete(pid);
		proc.terminal?.close();
		settleLaunch(pid, { ok: false, error: `omp exited with code ${code} before its session appeared.` });
	});
}

/** Sockets currently looking at a session or one of its subagents. */
const watchers = (instanceId: string): Socket[] =>
	[...sockets].filter(ws => ws.data.view?.kind === "live" && ws.data.view.instanceId === instanceId);
const sockets = new Set<Socket>();

/** A subagent view needs its transcript tailed; a fresh guest (after a rejoin) starts a new tail. */
function openAgentFor(ws: Socket): void {
	const view = ws.data.view;
	if (view?.kind !== "live" || !view.agentId) return;
	const tail = guests.get(view.instanceId)?.openAgent(view.agentId);
	if (tail?.loaded) send(ws, { t: "items", view, reset: true, items: tail.transcript.items() });
}

function unwatch(ws: Socket): void {
	const view = ws.data.view;
	ws.data.view = null;
	if (view?.kind !== "live") return;
	ws.unsubscribe(phaseTopic(view.instanceId));
	ws.unsubscribe(itemsTopic(view));
	if (view.agentId && server.subscriberCount(itemsTopic(view)) === 0) guests.get(view.instanceId)?.closeAgent(view.agentId);
}

/** A past session's transcript, read once from its file. The path comes from the listing, never from the page. */
async function sendPastTranscript(ws: Socket, view: PastView): Promise<void> {
	const path = saved.find(session => session.id === view.sessionId)?.path;
	const transcript = new Transcript();
	let items: Item[];
	if (!path) {
		items = transcript.note("error", "No saved session has this id.");
	} else {
		try {
			transcript.applyLines((await Bun.file(path).text()).split("\n"));
			items = transcript.items();
		} catch (err) {
			items = transcript.note("error", `Cannot read the session file: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	if (ws.data.view === view) send(ws, { t: "items", view, reset: true, items });
}

function watch(ws: Socket, view: View | null): void {
	unwatch(ws);
	if (!view) return;
	ws.data.view = view;
	if (view.kind === "past") {
		void sendPastTranscript(ws, view);
		return;
	}
	ws.subscribe(phaseTopic(view.instanceId));
	ws.subscribe(itemsTopic(view));
	const guest = guests.get(view.instanceId);
	if (!guest) {
		send(ws, { t: "phase", instanceId: view.instanceId, phase: { phase: "ended", reason: "This session is no longer running." } });
		return;
	}
	send(ws, { t: "phase", instanceId: view.instanceId, phase: guest.phase });
	if (view.agentId) openAgentFor(ws);
	else if (guest.phase.phase === "live") send(ws, { t: "items", view, reset: true, items: guest.transcript.items() });
}

function parseLiveView(value: unknown): LiveView | null {
	if (!isObject(value) || value.kind !== "live") return null;
	const { instanceId, agentId } = value;
	if (typeof instanceId !== "string" || (agentId !== null && typeof agentId !== "string")) return null;
	return { kind: "live", instanceId, agentId };
}

function parseView(value: unknown): View | null {
	if (isObject(value) && value.kind === "past") {
		return typeof value.sessionId === "string" ? { kind: "past", sessionId: value.sessionId } : null;
	}
	return parseLiveView(value);
}

function parseClientMsg(raw: string | Buffer): ClientMsg | null {
	let value: unknown;
	try {
		value = JSON.parse(String(raw));
	} catch {
		return null;
	}
	if (!isObject(value)) return null;
	switch (value.t) {
		case "watch": {
			if (value.view === null) return { t: "watch", view: null };
			const view = parseView(value.view);
			return view ? { t: "watch", view } : null;
		}
		case "prompt": {
			const view = parseLiveView(value.view);
			const text = value.text;
			return view && typeof text === "string" && text.trim() ? { t: "prompt", view, text } : null;
		}
		case "abort":
		case "end": {
			const id = value.instanceId;
			return typeof id === "string" ? { t: value.t, instanceId: id } : null;
		}
		case "create": {
			const cwd = value.cwd;
			return typeof cwd === "string" && cwd.trim() ? { t: "create", cwd } : null;
		}
		default:
			return null;
	}
}

function onClientMsg(ws: Socket, msg: ClientMsg): void {
	switch (msg.t) {
		case "watch":
			watch(ws, msg.view);
			return;
		case "prompt": {
			const guest = guests.get(msg.view.instanceId);
			if (msg.view.agentId) guest?.chat(msg.view.agentId, msg.text);
			else guest?.prompt(msg.text);
			return;
		}
		case "abort":
			guests.get(msg.instanceId)?.abort();
			return;
		case "create":
			launch(ws, msg.cwd);
			return;
		case "end": {
			const host = hosts.find(h => h.instanceId === msg.instanceId);
			if (host) owned.get(host.pid)?.kill();
			return;
		}
	}
}

function upgrade(req: Request, srv: Server<SocketData>): Response | undefined {
	const host = req.headers.get("host") ?? "";
	if (!ALLOWED_HOSTS.has(host) || req.headers.get("origin") !== `http://${host}`) {
		return new Response("forbidden origin", { status: 403 });
	}
	if (srv.upgrade(req, { data: { view: null } })) return undefined;
	return new Response("expected a websocket", { status: 426 });
}

let server: Server<SocketData>;
try {
	server = Bun.serve<SocketData>({
		hostname: HOSTNAME,
		port: PORT,
		development: false,
		routes: { "/": index },
		fetch(req, srv) {
			if (new URL(req.url).pathname === "/ws") return upgrade(req, srv);
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				sockets.add(ws);
				ws.subscribe("roster");
				send(ws, { t: "hello", ompVersion });
				send(ws, rosterMsg());
				send(ws, pastMsg());
			},
			message(ws, raw) {
				const msg = parseClientMsg(raw);
				if (msg) onClientMsg(ws, msg);
			},
			close(ws) {
				sockets.delete(ws);
				unwatch(ws);
			},
		},
	});
} catch (err) {
	console.error(`omp-agents: cannot listen on ${HOSTNAME}:${PORT}: ${err instanceof Error ? err.message : String(err)}`);
	console.error("Set PORT to use another port.");
	process.exit(1);
}

await pollRoster();
console.log(`omp-agents (omp v${ompVersion}) on http://${HOSTNAME}:${PORT}`);

function shutdown(): void {
	for (const guest of guests.values()) guest.end("Dashboard shut down.");
	for (const proc of owned.values()) proc.kill();
	server.stop(true);
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
