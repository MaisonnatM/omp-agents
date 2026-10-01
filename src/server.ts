import { homedir } from "node:os";
import type { Server, ServerWebSocket } from "bun";
import index from "../public/index.html";
import { SessionGuest } from "./guest";
import { type HostSnapshot, listHosts, ompVersion } from "./omp";
import type { ClientMsg, HostStatus, RosterHost, ServerMsg } from "./shared";

const PORT = Number(process.env.PORT ?? 4317);
const HOSTNAME = "127.0.0.1";
const POLL_MS = 1500;
const HOME = homedir();
/** Only pages served by this app may open the socket: it carries full control of every session. */
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

interface SocketData {
	watching: string | null;
}
type Socket = ServerWebSocket<SocketData>;

let roster: RosterHost[] = [];
let rosterError: string | null = null;
let rosterJson = "";
const guests = new Map<string, SessionGuest>();

const topic = (instanceId: string): string => `session:${instanceId}`;
const send = (ws: Socket, msg: ServerMsg): void => void ws.send(JSON.stringify(msg));
const publish = (channel: string, msg: ServerMsg): void => void server.publish(channel, JSON.stringify(msg));

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
	};
}

function spawnGuest(host: RosterHost): SessionGuest {
	const guest = new SessionGuest(host, update => {
		const instanceId = host.instanceId;
		if (update.kind === "phase") publish(topic(instanceId), { t: "phase", instanceId, phase: update.phase });
		else publish(topic(instanceId), { t: "items", instanceId, reset: update.reset, items: update.items });
	});
	guests.set(host.instanceId, guest);
	return guest;
}

function releaseIfUnwatched(instanceId: string): void {
	if (server.subscriberCount(topic(instanceId)) > 0) return;
	guests.get(instanceId)?.end("No longer watched.");
	guests.delete(instanceId);
}

/** Follow the registry: drop guests whose host vanished, rejoin hosts that rotated to a new room. */
function reconcileGuests(): void {
	for (const [instanceId, guest] of guests) {
		const host = roster.find(h => h.instanceId === instanceId);
		if (!host) {
			guest.end("This session is no longer running.");
			guests.delete(instanceId);
		} else if (guest.generation !== null && guest.generation !== host.generation) {
			guest.end("The session switched rooms; rejoining.");
			guests.delete(instanceId);
			if (server.subscriberCount(topic(instanceId)) > 0) spawnGuest(host);
		}
	}
}

async function pollRoster(): Promise<void> {
	try {
		roster = (await listHosts()).map(toRosterHost);
		rosterError = null;
	} catch (err) {
		roster = [];
		rosterError = err instanceof Error ? err.message : String(err);
	}
	reconcileGuests();
	const msg: ServerMsg = { t: "roster", hosts: roster, error: rosterError };
	const json = JSON.stringify(msg);
	if (json !== rosterJson) {
		rosterJson = json;
		server.publish("roster", json);
	}
	setTimeout(pollRoster, POLL_MS);
}

function watch(ws: Socket, instanceId: string | null): void {
	const previous = ws.data.watching;
	ws.data.watching = instanceId;
	if (previous && previous !== instanceId) {
		ws.unsubscribe(topic(previous));
		releaseIfUnwatched(previous);
	}
	if (!instanceId) return;
	const host = roster.find(h => h.instanceId === instanceId);
	if (!host) {
		send(ws, { t: "phase", instanceId, phase: { phase: "ended", reason: "This session is no longer running." } });
		return;
	}
	ws.subscribe(topic(instanceId));
	let guest = guests.get(instanceId);
	if (!guest || guest.phase.phase === "ended") guest = spawnGuest(host);
	send(ws, { t: "phase", instanceId, phase: guest.phase });
	if (guest.phase.phase === "live") send(ws, { t: "items", instanceId, reset: true, items: guest.transcript.items() });
}

function parseClientMsg(raw: string | Buffer): ClientMsg | null {
	let value: unknown;
	try {
		value = JSON.parse(String(raw));
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || !("t" in value)) return null;
	const id = "instanceId" in value ? value.instanceId : undefined;
	switch (value.t) {
		case "watch":
			return id === null || typeof id === "string" ? { t: "watch", instanceId: id } : null;
		case "prompt": {
			const text = "text" in value ? value.text : undefined;
			return typeof id === "string" && typeof text === "string" && text.trim() ? { t: "prompt", instanceId: id, text } : null;
		}
		case "abort":
			return typeof id === "string" ? { t: "abort", instanceId: id } : null;
		default:
			return null;
	}
}

function upgrade(req: Request, srv: Server<SocketData>): Response | undefined {
	const host = req.headers.get("host") ?? "";
	if (!ALLOWED_HOSTS.has(host) || req.headers.get("origin") !== `http://${host}`) {
		return new Response("forbidden origin", { status: 403 });
	}
	if (srv.upgrade(req, { data: { watching: null } })) return undefined;
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
				ws.subscribe("roster");
				send(ws, { t: "hello", ompVersion });
				send(ws, { t: "roster", hosts: roster, error: rosterError });
			},
			message(ws, raw) {
				const msg = parseClientMsg(raw);
				if (!msg) return;
				if (msg.t === "watch") watch(ws, msg.instanceId);
				else if (msg.t === "prompt") guests.get(msg.instanceId)?.prompt(msg.text);
				else guests.get(msg.instanceId)?.abort();
			},
			close(ws) {
				if (ws.data.watching) releaseIfUnwatched(ws.data.watching);
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
