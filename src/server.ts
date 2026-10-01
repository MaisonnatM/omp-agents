import { homedir } from "node:os";
import type { Server, ServerWebSocket } from "bun";
import index from "../web/index.html";
import { type GuestUpdate, SessionGuest } from "./guest";
import { type HostSnapshot, listHosts, ompVersion } from "./omp";
import type { ClientMsg, HostStatus, RosterHost, ServerMsg, View } from "./shared";

const PORT = Number(process.env.PORT ?? 4317);
const HOSTNAME = "127.0.0.1";
const POLL_MS = 1500;
/** Wait this long before rejoining a host whose room dropped us while it stays listed. */
const REJOIN_MS = 5000;
/** Coalesce bursts of subagent progress into one roster push. */
const ROSTER_PUSH_MS = 150;
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
/** One guest per listed host, so every session's subagents are known without opening it. */
const guests = new Map<string, SessionGuest>();

const phaseTopic = (instanceId: string): string => `phase:${instanceId}`;
const itemsTopic = (view: View): string => `items:${view.instanceId}:${view.agentId ?? ""}`;
const send = (ws: Socket, msg: ServerMsg): void => void ws.send(JSON.stringify(msg));
const publish = (topic: string, msg: ServerMsg): void => void server.publish(topic, JSON.stringify(msg));

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
		cwdDisplay: host.cwd === HOME || host.cwd.startsWith(`${HOME}/`) ? `~${host.cwd.slice(HOME.length)}` : host.cwd,
		model: host.model ? `${host.model.provider}/${host.model.id}` : null,
		startedAt: host.startedAt,
		participants: host.participants,
		relayConnected: host.relayConnected,
		status: statusOf(host),
		access: host.access,
		agents: guests.get(host.instanceId)?.agents() ?? [],
	};
}

function rosterMsg(): ServerMsg {
	return { t: "roster", hosts: hosts.map(toRosterHost), error: rosterError };
}

function pushRoster(): void {
	clearTimeout(rosterPush);
	rosterPush = undefined;
	const json = JSON.stringify(rosterMsg());
	if (json === rosterJson) return;
	rosterJson = json;
	server.publish("roster", json);
}

function onGuestUpdate(instanceId: string, update: GuestUpdate): void {
	switch (update.kind) {
		case "phase":
			publish(phaseTopic(instanceId), { t: "phase", instanceId, phase: update.phase });
			return;
		case "items": {
			const view = { instanceId, agentId: update.agentId };
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
	reconcileGuests();
	pushRoster();
	setTimeout(pollRoster, POLL_MS);
}

/** Sockets currently looking at a session or one of its subagents. */
const watchers = (instanceId: string): Socket[] => [...sockets].filter(ws => ws.data.view?.instanceId === instanceId);
const sockets = new Set<Socket>();

/** A subagent view needs its transcript tailed; a fresh guest (after a rejoin) starts a new tail. */
function openAgentFor(ws: Socket): void {
	const view = ws.data.view;
	if (!view?.agentId) return;
	const tail = guests.get(view.instanceId)?.openAgent(view.agentId);
	if (tail?.loaded) send(ws, { t: "items", view, reset: true, items: tail.transcript.items() });
}

function unwatch(ws: Socket): void {
	const view = ws.data.view;
	if (!view) return;
	ws.data.view = null;
	ws.unsubscribe(phaseTopic(view.instanceId));
	ws.unsubscribe(itemsTopic(view));
	if (view.agentId && server.subscriberCount(itemsTopic(view)) === 0) guests.get(view.instanceId)?.closeAgent(view.agentId);
}

function watch(ws: Socket, view: View | null): void {
	unwatch(ws);
	if (!view) return;
	ws.data.view = view;
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

function parseView(value: unknown): View | null {
	if (typeof value !== "object" || value === null || !("instanceId" in value) || !("agentId" in value)) return null;
	const { instanceId, agentId } = value;
	if (typeof instanceId !== "string" || (agentId !== null && typeof agentId !== "string")) return null;
	return { instanceId, agentId };
}

function parseClientMsg(raw: string | Buffer): ClientMsg | null {
	let value: unknown;
	try {
		value = JSON.parse(String(raw));
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || !("t" in value)) return null;
	switch (value.t) {
		case "watch": {
			const requested = "view" in value ? value.view : undefined;
			if (requested === null) return { t: "watch", view: null };
			const view = parseView(requested);
			return view ? { t: "watch", view } : null;
		}
		case "prompt": {
			const view = parseView("view" in value ? value.view : undefined);
			const text = "text" in value ? value.text : undefined;
			return view && typeof text === "string" && text.trim() ? { t: "prompt", view, text } : null;
		}
		case "abort": {
			const id = "instanceId" in value ? value.instanceId : undefined;
			return typeof id === "string" ? { t: "abort", instanceId: id } : null;
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
	server.stop(true);
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
