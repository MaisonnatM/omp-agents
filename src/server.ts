import { mkdirSync, statSync, watch as watchFiles } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import index from "../web/index.html";
import { complete, expandPrompt, forgetSession } from "./commands";
import { DashboardSession, type DashboardUpdate, type ForkedSession } from "./dashboard-session";
import { type LiveUpdate, SessionGuest } from "./guest";
import { FileTail } from "./tail";
import { displayPath, type HostSnapshot, listHosts, listModels, listSessionFiles, ompVersion, type SavedSession, sessionsDir } from "./omp";
import { PullRequestIndex } from "./pull-requests";
import { loadOmpSettings, Rejected, saveOmpFile, saveRouting } from "./settings";
import type { ClientMsg, HostStatus, Item, LiveView, PullRequest, RosterHost, ServerMsg, SettingsError, UserAnswer, View } from "./shared";
import { isObject } from "./transcript";
import { fetchPlanUsage } from "./usage";

const PORT = Number(process.env.PORT ?? 4317);
const HOSTNAME = "127.0.0.1";
/** The registry has no change feed; listing it is one local IPC round trip per host. */
const POLL_MS = 1500;
/** Wait this long before rejoining a host whose room dropped us while it stays listed. */
const REJOIN_MS = 5000;
/** Coalesce bursts of subagent progress into one roster push. */
const ROSTER_PUSH_MS = 150;
/** Re-list session files at most this often while sessions write. */
const LIST_THROTTLE_MS = 500;
/** `omp usage` caches provider reports itself; each run still costs a process and up to one network round trip per provider. */
const USAGE_POLL_MS = 60_000;
const HOME = homedir();
/**
 * Only pages served by this app may open the socket, which carries full control of every session, or read omp's files.
 * DNS rebinding cannot pass the Host check; a cross-site page cannot pass the Origin check that also guards writes.
 */
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedHost = (req: Request): boolean => ALLOWED_HOSTS.has(req.headers.get("host") ?? "");
const sameOrigin = (req: Request): boolean => allowedHost(req) && req.headers.get("origin") === `http://${req.headers.get("host")}`;

interface SocketData {
	/** The views this socket shows, by {@link viewKey}. */
	views: Map<string, View>;
}
type Socket = ServerWebSocket<SocketData>;

/** Terminal sessions publishing themselves to the Collab registry. */
let hosts: HostSnapshot[] = [];
let rosterError: string | null = null;
let rosterJson = "";
let rosterPush: NodeJS.Timeout | undefined;
/** One guest per terminal session, so every session's subagents are known without opening it. */
const guests = new Map<string, SessionGuest>();
/** Sessions this dashboard started, by instance id. They live only as long as the dashboard. */
const dashboards = new Map<string, DashboardSession>();
/** Every session file on disk, newest first, and the same files by session id. */
let files: SavedSession[] = [];
let fileById = new Map<string, SavedSession>();
let pastJson = "";
const pullRequestIndex = new PullRequestIndex();
let listTimer: NodeJS.Timeout | undefined;
/** Views some socket shows, with how many sockets show each; each has a tail while its file is known. */
const watched = new Map<string, { view: View; sockets: number }>();
const tails = new Map<string, FileTail>();
/** The last `usage` message, empty until the first `omp usage` run finishes. */
let usageJson = "";

const viewKey = (view: View): string =>
	view.kind === "past" ? `past:${view.sessionId}` : `live:${view.instanceId}:${view.agentId ?? ""}`;
const itemsTopic = (key: string): string => `items:${key}`;
const send = (ws: Socket, msg: ServerMsg): void => void ws.send(JSON.stringify(msg));
const publish = (topic: string, msg: ServerMsg): void => void server.publish(topic, JSON.stringify(msg));

const pullRequestsOf = (sessionId: string): PullRequest[] => {
	const path = fileById.get(sessionId)?.path;
	return path ? pullRequestIndex.of(path) : [];
};

function statusOf(host: HostSnapshot): HostStatus {
	if (host.inputRequired) return "needs-input";
	if (host.busy === null) return "unknown";
	return host.busy ? "working" : "idle";
}

function rosterHosts(): RosterHost[] {
	const terminal = hosts.map((host): RosterHost => {
		const guest = guests.get(host.instanceId);
		return {
			source: "terminal",
			instanceId: host.instanceId,
			pid: host.pid,
			sessionId: host.sessionId,
			sessionName: host.sessionName,
			cwd: host.cwd,
			cwdDisplay: displayPath(host.cwd),
			// The room's status-line snapshot, else the registry row until the guest is welcomed.
			model: guest?.state?.model ?? (host.model ? `${host.model.provider}/${host.model.id}` : null),
			thinkingLevel: guest?.state?.thinkingLevel ?? null,
			context: guest?.state?.context ?? null,
			startedAt: host.startedAt,
			participants: host.participants,
			relayConnected: host.relayConnected,
			status: statusOf(host),
			control: guest?.control ?? { phase: "connecting" },
			agents: guest?.agents() ?? [],
			pullRequests: pullRequestsOf(host.sessionId),
			requests: guest?.requests() ?? [],
		};
	});
	const started = [...dashboards.values()].map(
		(session): RosterHost => ({
			source: "dashboard",
			instanceId: session.instanceId,
			pid: session.pid,
			sessionId: session.sessionId,
			sessionName: session.sessionName,
			cwd: session.cwd,
			cwdDisplay: displayPath(session.cwd),
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			thinkingLevels: session.thinkingLevels,
			context: session.context,
			startedAt: session.startedAt,
			status: session.status,
			control: { phase: "live", readOnly: false },
			agents: session.agents(),
			pullRequests: pullRequestsOf(session.sessionId),
			requests: session.requests(),
		}),
	);
	return [...terminal, ...started];
}

function pastMsg(): ServerMsg {
	const live = new Set([...hosts.map(host => host.sessionId), ...[...dashboards.values()].map(s => s.sessionId)]);
	const sessions = files
		.filter(session => !session.empty && !live.has(session.id))
		.map(session => ({
			sessionId: session.id,
			title: session.title,
			cwd: session.cwd,
			cwdDisplay: displayPath(session.cwd),
			modifiedAt: session.modifiedAt,
			pullRequests: pullRequestIndex.of(session.path),
		}));
	return { t: "past", sessions };
}

function pushRoster(): void {
	clearTimeout(rosterPush);
	rosterPush = undefined;
	const json = JSON.stringify({ t: "roster", hosts: rosterHosts(), error: rosterError } satisfies ServerMsg);
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

async function pollUsage(): Promise<void> {
	let msg: ServerMsg;
	try {
		msg = { t: "usage", plans: await fetchPlanUsage(), error: null };
	} catch (err) {
		msg = { t: "usage", plans: [], error: err instanceof Error ? err.message : String(err) };
	}
	const json = JSON.stringify(msg);
	if (json !== usageJson) {
		usageJson = json;
		server.publish("roster", json);
	}
	setTimeout(pollUsage, USAGE_POLL_MS);
}

/** The file a view reads, or `null` while it is not known (not listed yet, or no such session). */
function pathFor(view: View): string | null {
	if (view.kind === "past") return fileById.get(view.sessionId)?.path ?? null;
	const dashboard = dashboards.get(view.instanceId);
	if (dashboard) return view.agentId ? dashboard.agentFile(view.agentId) : dashboard.sessionFile;
	const host = hosts.find(h => h.instanceId === view.instanceId);
	const sessionFile = host ? (fileById.get(host.sessionId)?.path ?? null) : null;
	if (!sessionFile || !view.agentId) return sessionFile;
	return guests.get(view.instanceId)?.agentFile(sessionFile, view.agentId) ?? null;
}

/** Point every watched view's tail at its current file: the file shows up, the host switches sessions, a subagent registers. */
function syncTails(): void {
	for (const [key, { view }] of watched) {
		const path = pathFor(view);
		const tail = tails.get(key);
		if (tail?.path === path) continue;
		tails.delete(key);
		if (!path) {
			if (tail) publish(itemsTopic(key), { t: "items", view, reset: true, items: [] });
			continue;
		}
		const next = new FileTail(path, (reset, items) => {
			if (tails.get(key) === next) publish(itemsTopic(key), { t: "items", view, reset, items });
		});
		tails.set(key, next);
		next.poke();
	}
}

/**
 * The watcher does not report every append: on macOS a burst of writes can surface
 * only as events for omp's `.<file>.lock` sidecar. Any change in a directory therefore
 * re-reads every tail in it; a re-read with nothing new costs one `stat`.
 */
function onFileChange(path: string): void {
	const dir = dirname(path);
	for (const tail of tails.values()) if (dirname(tail.path) === dir) tail.poke();
	// Session files sit one directory below the root; deeper files belong to subagents.
	if (dirname(dir) === sessionsDir) listTimer ??= setTimeout(refreshFiles, LIST_THROTTLE_MS);
}

async function refreshFiles(): Promise<void> {
	files = await listSessionFiles();
	fileById = new Map(files.map(file => [file.id, file]));
	listTimer = undefined;
	syncTails();
	pushPast();
	// The first scan reads every transcript; the list shows before it finishes.
	void pullRequestIndex.refresh(files).then(changed => {
		if (!changed) return;
		pushPast();
		pushRoster();
	});
}

function onLiveUpdate(instanceId: string, update: LiveUpdate | DashboardUpdate): void {
	switch (update.kind) {
		case "roster":
			rosterPush ??= setTimeout(pushRoster, ROSTER_PUSH_MS);
			// A subagent may have registered for a view that waits on its file.
			syncTails();
			return;
		case "event":
			tails.get(viewKey({ kind: "live", instanceId, agentId: null }))?.live(t => t.applyEvent(update.event));
			return;
		case "note":
			tails.get(viewKey({ kind: "live", instanceId, agentId: update.agentId }))?.live(t => t.note(update.level, update.text));
			return;
		case "exited":
			dashboards.delete(instanceId);
			syncTails();
			pushRoster();
			void refreshFiles();
			return;
	}
}

/** Follow the registry: join new hosts, drop vanished ones, rejoin rotated or dropped rooms. */
function reconcileGuests(): void {
	const listed = new Map(hosts.map(host => [host.instanceId, host]));
	for (const [instanceId, guest] of guests) {
		const host = listed.get(instanceId);
		if (!host) {
			guest.end("This session is no longer running.");
			guests.delete(instanceId);
			forgetSession(instanceId);
		} else if (guest.generation !== null && guest.generation !== host.generation) {
			guest.end("The session switched rooms; rejoining.");
			guests.delete(instanceId);
			forgetSession(instanceId);
		} else if (guest.endedAt !== null && Date.now() - guest.endedAt > REJOIN_MS) {
			guests.delete(instanceId);
		}
	}
	for (const host of hosts) {
		if (!guests.has(host.instanceId)) {
			guests.set(host.instanceId, new SessionGuest(host, update => onLiveUpdate(host.instanceId, update)));
		}
	}
}

async function pollRegistry(): Promise<void> {
	try {
		hosts = await listHosts();
		rosterError = null;
	} catch (err) {
		hosts = [];
		rosterError = err instanceof Error ? err.message : String(err);
	}
	reconcileGuests();
	syncTails();
	pushRoster();
	pushPast();
	setTimeout(pollRegistry, POLL_MS);
}

/** Start omp in `input` (absolute, `~`-relative, or relative to the home directory) and answer once it is ready. */
async function launch(ws: Socket, input: string): Promise<void> {
	const raw = input.trim();
	const cwd = raw === "~" || raw.startsWith("~/") ? join(HOME, raw.slice(1)) : resolve(HOME, raw);
	try {
		if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
	} catch {
		send(ws, { t: "created", result: { ok: false, error: `${raw} is not a directory.` } });
		return;
	}
	let session: DashboardSession;
	try {
		session = await DashboardSession.start(cwd, update => onLiveUpdate(session.instanceId, update));
	} catch (err) {
		send(ws, { t: "created", result: { ok: false, error: `Cannot start omp: ${err instanceof Error ? err.message : String(err)}` } });
		return;
	}
	dashboards.set(session.instanceId, session);
	pushRoster();
	send(ws, { t: "created", result: { ok: true, instanceId: session.instanceId } });
}

/** Fork the view's session file at the user prompt `entryId` into a new dashboard session, and answer once it is ready. */
async function fork(ws: Socket, view: View, entryId: string): Promise<void> {
	const source = pathFor(view);
	if (!source) {
		send(ws, { t: "forked", result: { ok: false, error: "Cannot fork: this session's file is not known yet." } });
		return;
	}
	let forked: ForkedSession;
	try {
		forked = await DashboardSession.fork(source, entryId, update => onLiveUpdate(forked.session.instanceId, update));
	} catch (err) {
		send(ws, { t: "forked", result: { ok: false, error: `Cannot fork: ${err instanceof Error ? err.message : String(err)}` } });
		return;
	}
	dashboards.set(forked.session.instanceId, forked.session);
	pushRoster();
	pushPast();
	send(ws, { t: "forked", result: { ok: true, instanceId: forked.session.instanceId, prompt: forked.prompt } });
}

const watching = (ws: Socket, instanceId: string): boolean =>
	[...ws.data.views.values()].some(view => view.kind === "live" && view.instanceId === instanceId);

/** Make `views` the socket's whole watch set. Views it already shows keep streaming without a fresh transcript. */
function watch(ws: Socket, views: View[]): void {
	const next = new Map(views.map(view => [viewKey(view), view]));
	const prev = ws.data.views;
	ws.data.views = next;
	for (const key of prev.keys()) {
		if (next.has(key)) continue;
		ws.unsubscribe(itemsTopic(key));
		const entry = watched.get(key);
		if (entry && --entry.sockets === 0) {
			watched.delete(key);
			tails.delete(key);
		}
	}
	const added = [...next].filter(([key]) => !prev.has(key));
	for (const [key, view] of added) {
		ws.subscribe(itemsTopic(key));
		const entry = watched.get(key);
		if (entry) entry.sockets++;
		else watched.set(key, { view, sockets: 1 });
	}
	syncTails();
	for (const [key, view] of added) {
		const tail = tails.get(key);
		// A tail still loading publishes its first read to every subscriber, this socket included.
		if (tail?.loaded) send(ws, { t: "items", view, reset: true, items: tail.transcript.items() });
		else if (!tail) send(ws, { t: "items", view, reset: true, items: [] });
	}
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

function parseAnswer(value: unknown): UserAnswer | null {
	if (!isObject(value)) return null;
	if (value.kind === "cancel") return { kind: "cancel" };
	if (value.kind === "value" && typeof value.value === "string") return { kind: "value", value: value.value };
	if (value.kind === "confirm" && typeof value.confirmed === "boolean") return { kind: "confirm", confirmed: value.confirmed };
	return null;
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
			if (!Array.isArray(value.views)) return null;
			const views = value.views.map(parseView);
			return views.every(view => view !== null) ? { t: "watch", views } : null;
		}
		case "prompt": {
			const view = parseLiveView(value.view);
			const text = value.text;
			return view && typeof text === "string" && text.trim() ? { t: "prompt", view, text } : null;
		}
		case "complete": {
			const view = parseLiveView(value.view);
			const { reqId, text, cursor } = value;
			return view && typeof reqId === "number" && Number.isSafeInteger(reqId) && reqId >= 0 &&
				typeof text === "string" && text.length <= 4096 && typeof cursor === "number" &&
				Number.isInteger(cursor) && cursor >= 0 && cursor <= text.length
				? { t: "complete", reqId, view, text, cursor } : null;
		}
		case "abort":
		case "end":
		case "list-models": {
			const id = value.instanceId;
			return typeof id === "string" ? { t: value.t, instanceId: id } : null;
		}
		case "create": {
			const cwd = value.cwd;
			return typeof cwd === "string" && cwd.trim() ? { t: "create", cwd } : null;
		}
		case "fork": {
			const view = parseView(value.view);
			const entryId = value.entryId;
			return view && typeof entryId === "string" && entryId ? { t: "fork", view, entryId } : null;
		}
		case "set-model": {
			const { instanceId, model } = value;
			return typeof instanceId === "string" && isObject(model) && typeof model.provider === "string" && typeof model.id === "string"
				? { t: "set-model", instanceId, model: { provider: model.provider, id: model.id } } : null;
		}
		case "set-thinking": {
			const { instanceId, level } = value;
			return typeof instanceId === "string" && typeof level === "string" ? { t: "set-thinking", instanceId, level } : null;
		}
		case "answer": {
			const { instanceId, requestId } = value;
			const answer = parseAnswer(value.answer);
			return typeof instanceId === "string" && typeof requestId === "string" && answer
				? { t: "answer", instanceId, requestId, answer } : null;
		}
		default:
			return null;
	}
}

async function onClientMsg(ws: Socket, msg: ClientMsg): Promise<void> {
	switch (msg.t) {
		case "watch":
			watch(ws, msg.views);
			return;
		case "complete": {
			const host = hosts.find(row => row.instanceId === msg.view.instanceId) ?? dashboards.get(msg.view.instanceId);
			if (!host || !watching(ws, msg.view.instanceId)) return;
			try {
				const items = await complete(host.instanceId, host.cwd, msg.text, msg.cursor);
				if (watching(ws, host.instanceId)) send(ws, { t: "completions", view: msg.view, reqId: msg.reqId, items, error: null });
			} catch (error) {
				send(ws, { t: "completions", view: msg.view, reqId: msg.reqId, items: [], error: String(error) });
			}
			return;
		}
		case "prompt": {
			const dashboard = dashboards.get(msg.view.instanceId);
			if (dashboard) {
				// omp's RPC prompt runs the session's own slash-command and skill pipeline.
				if (!msg.view.agentId) dashboard.prompt(msg.text);
				return;
			}
			const host = hosts.find(row => row.instanceId === msg.view.instanceId);
			const guest = guests.get(msg.view.instanceId);
			if (!host || !guest || !watching(ws, msg.view.instanceId)) return;
			try {
				const text = await expandPrompt(host.instanceId, host.cwd, msg.text, msg.view.agentId ? "subagent" : "session");
				if (msg.view.agentId) guest.chat(msg.view.agentId, text);
				else guest.prompt(text);
			} catch (error) {
				send(ws, { t: "items", view: msg.view, reset: false, items: [
					{ id: `error:${Date.now()}`, kind: "notice", level: "error", text: `Could not prepare prompt: ${String(error)}` },
				] });
			}
			return;
		}
		case "abort":
			dashboards.get(msg.instanceId)?.abort();
			guests.get(msg.instanceId)?.abort();
			return;
		case "create":
			void launch(ws, msg.cwd);
			return;
		case "fork":
			void fork(ws, msg.view, msg.entryId);
			return;
		case "end":
			void dashboards.get(msg.instanceId)?.end();
			return;
		case "list-models": {
			const dashboard = dashboards.get(msg.instanceId);
			if (!dashboard) {
				send(ws, { t: "models", instanceId: msg.instanceId, models: [], error: "Only sessions started from this dashboard can switch models." });
				return;
			}
			try {
				send(ws, { t: "models", instanceId: msg.instanceId, models: await dashboard.models(), error: null });
			} catch (error) {
				send(ws, { t: "models", instanceId: msg.instanceId, models: [], error: String(error) });
			}
			return;
		}
		case "set-model":
			dashboards.get(msg.instanceId)?.setModel(msg.model);
			return;
		case "set-thinking": {
			const dashboard = dashboards.get(msg.instanceId);
			if (dashboard?.thinkingLevels.includes(msg.level)) dashboard.setThinkingLevel(msg.level);
			return;
		}
		case "answer":
			dashboards.get(msg.instanceId)?.answer(msg.requestId, msg.answer);
			guests.get(msg.instanceId)?.answer(msg.requestId, msg.answer);
			return;
	}
}

function upgrade(req: Request, srv: Server<SocketData>): Response | undefined {
	if (!sameOrigin(req)) return new Response("forbidden origin", { status: 403 });
	if (srv.upgrade(req, { data: { views: new Map() } })) return undefined;
	return new Response("expected a websocket", { status: 426 });
}

const fail = (status: number, error: string, conflict = false): Response =>
	Response.json({ error, ...(conflict && { conflict: true }) } satisfies SettingsError, { status });

/**
 * The `cwd` a settings request names, `null` for user-level only, or the response refusing it. `cwd` must be a
 * directory some session ran in: the page names workspaces that way, as it names sessions by id.
 */
function settingsCwd(req: Request): string | null | Response {
	const cwd = new URL(req.url).searchParams.get("cwd");
	const sessionRan =
		cwd === null ||
		hosts.some(host => host.cwd === cwd) ||
		[...dashboards.values()].some(session => session.cwd === cwd) ||
		files.some(session => session.cwd === cwd);
	return sessionRan ? cwd : fail(404, `No session ran in ${cwd}`);
}

async function answer(run: () => Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await run());
	} catch (err) {
		if (err instanceof Rejected) return fail(err.status, err.message, err.conflict);
		return fail(500, err instanceof Error ? err.message : String(err));
	}
}

/** `GET /api/settings[?cwd=<dir>]`: omp's model routing and files, user-level only without `cwd`. */
async function settings(req: Request): Promise<Response> {
	if (!allowedHost(req)) return fail(403, "forbidden host");
	const cwd = settingsCwd(req);
	return cwd instanceof Response ? cwd : answer(() => loadOmpSettings(cwd));
}

/** `GET /api/models`: the models omp lists, for the settings page's pickers. */
async function models(req: Request): Promise<Response> {
	if (!allowedHost(req)) return fail(403, "forbidden host");
	return answer(async () => ({ models: await listModels() }));
}

/**
 * A settings write: `PUT /api/settings/routing` or `/api/settings/file`, `?cwd=` as for reading.
 * Only this app's own page may write, with a JSON body; the answer is the settings as they load after the write.
 */
function settingsWrite(save: (cwd: string | null, body: unknown) => Promise<unknown>) {
	return async (req: Request): Promise<Response> => {
		if (!sameOrigin(req)) return fail(403, "forbidden origin");
		if (req.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
			return fail(415, "Expected a JSON body");
		}
		const cwd = settingsCwd(req);
		if (cwd instanceof Response) return cwd;
		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return fail(400, "The body is not valid JSON");
		}
		return answer(() => save(cwd, body));
	};
}

let server: Server<SocketData>;
try {
	server = Bun.serve<SocketData>({
		hostname: HOSTNAME,
		port: PORT,
		development: false,
		routes: {
			"/": index,
			"/api/settings": { GET: settings },
			"/api/settings/routing": { PUT: settingsWrite(saveRouting) },
			"/api/settings/file": { PUT: settingsWrite(saveOmpFile) },
			"/api/models": { GET: models },
		},
		fetch(req, srv) {
			const { pathname } = new URL(req.url);
			if (pathname === "/ws") return upgrade(req, srv);
			if (pathname.startsWith("/api/")) return fail(404, `No ${req.method} ${pathname}`);
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				ws.subscribe("roster");
				send(ws, { t: "roster", hosts: rosterHosts(), error: rosterError });
				send(ws, pastMsg());
				if (usageJson) ws.send(usageJson);
			},
			message(ws, raw) {
				const msg = parseClientMsg(raw);
				if (msg) void onClientMsg(ws, msg);
			},
			close(ws) {
				watch(ws, []);
			},
		},
	});
} catch (err) {
	console.error(`omp-agents: cannot listen on ${HOSTNAME}:${PORT}: ${err instanceof Error ? err.message : String(err)}`);
	console.error("Set PORT to use another port.");
	process.exit(1);
}

// One recursive watcher on omp's sessions directory drives every tail and the past-session list.
mkdirSync(sessionsDir, { recursive: true });
watchFiles(sessionsDir, { recursive: true }, (_event, name) => {
	if (name) onFileChange(join(sessionsDir, String(name)));
});
await refreshFiles();
await pollRegistry();
void pollUsage();
console.log(`omp-agents (omp v${ompVersion}) on http://${HOSTNAME}:${PORT}`);

async function shutdown(): Promise<void> {
	for (const guest of guests.values()) guest.end("Dashboard shut down.");
	await Promise.all([...dashboards.values()].map(session => session.end()));
	server.stop(true);
	process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
