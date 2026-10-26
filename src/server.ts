/** The dashboard server: builds the {@link Dashboard}, serves its HTTP API, page, and sockets, then sets it following omp's files and registry; **Update dashboard** runs it again in place. */
import "./preflight";
import type { Server, ServerWebSocket } from "bun";
import { errorText } from "./json";
import { ompVersion } from "./omp/install";
import { displayPath, tokenFile } from "./paths";
import { HOSTNAME, listeningLine, originOf, portFromEnv } from "./server/address";
import { loadToken } from "./server/auth";
import { Dashboard } from "./server/dashboard";
import { fail, guardsFor, refuseUntil } from "./server/http";
import { loadPage, pageBuild, servePage } from "./server/page";
import { prebuiltPageDir, sourceDir } from "./server/resources";
import { SelfUpdate } from "./server/self-update";
import { describeServed, readSourceIdentity, type ServedBuild } from "./served-build";
import { terminalFor, type TerminalSocket, type TerminalSocketData, terminalSocket } from "./server/terminal-socket";
import type { Socket, SocketData } from "./server/views";
import type { ServerMsg } from "./shared/protocol";
import { parsePageId } from "./server/wire";

const PORT = portFromEnv();
const token = loadToken(tokenFile);
const guards = guardsFor(PORT, token);
// Read before the page builds, so an edit landing during the build leaves the record older than the page, which reads as stale, never newer.
const startedAt = new Date().toISOString();
const source = prebuiltPageDir
	? null
	: await readSourceIdentity(sourceDir).catch(err => {
			console.error(`omp-agents: cannot tell which code this server serves: ${errorText(err)}`);
			return null;
		});
const page = await loadPage();
const served: ServedBuild = { source, page: await pageBuild(page), pid: process.pid, startedAt };
const buildMsg = JSON.stringify({ t: "build", id: served.page } satisfies ServerMsg);
const dashboard = new Dashboard(PORT, await SelfUpdate.forServer(restart));
// The port is bound before the sessions are attached, so a taken port fails before any keeper is joined, but no page
// may start or resume a session until the server knows which ones survived.
const notReattached = refuseUntil(dashboard.reattached, "The dashboard is still attaching to the sessions that kept running.");

/** A socket is the dashboard's own, which watches views, or a terminal tab's, which carries one shell. */
type AnySocketData = SocketData | TerminalSocketData;
const isTerminalSocket = (ws: ServerWebSocket<AnySocketData>): ws is TerminalSocket => "terminal" in ws.data;

const NOT_A_WEBSOCKET = (): Response => new Response("expected a websocket", { status: 426 });

function upgrade(req: Request, srv: Server<AnySocketData>): Response | undefined {
	const refused = guards.admitSocket(req) ?? notReattached();
	if (refused) return refused;
	// A page loaded before page ids connects with none; its views still update, and its tagged requests, which carry no `floor`, are dropped until it reloads.
	const pageId = parsePageId(new URL(req.url).searchParams.get("page")) ?? crypto.randomUUID();
	return srv.upgrade(req, { data: { views: new Map(), trajectories: new Map(), pageId }, headers: guards.socketHeaders(req) }) ? undefined : NOT_A_WEBSOCKET();
}

async function upgradeTerminal(req: Request, srv: Server<AnySocketData>): Promise<Response | undefined> {
	const refused = guards.admitSocket(req);
	if (refused) return refused;
	const params = new URL(req.url).searchParams;
	const terminal = await terminalFor(dashboard.terminals, params);
	if (terminal instanceof Response) return terminal;
	if (srv.upgrade(req, { data: { terminal, detach: null }, headers: guards.socketHeaders(req) })) return undefined;
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
		routes: dashboard.routes(guards, served),
		fetch(req, srv) {
			const { pathname } = new URL(req.url);
			if (pathname === "/ws") return upgrade(req, srv);
			if (pathname === "/ws/terminal") return upgradeTerminal(req, srv);
			if (pathname === "/api/hello") return guards.hello(req);
			if (pathname.startsWith("/api/")) return guards.admit(req) ?? fail(404, `No ${req.method} ${pathname}`);
			return servePage(req, guards, token, page);
		},
		websocket: {
			// A prompt's images travel as base64 in one message: MAX_PROMPT_IMAGE_BYTES of them, a third more as base64.
			maxPayloadLength: 64 * 1024 * 1024,
			open(ws) {
				if (isTerminalSocket(ws)) return terminalSocket.open(ws);
				ws.send(buildMsg);
				dashboard.open(ws as Socket);
			},
			message(ws, raw) {
				if (isTerminalSocket(ws)) return terminalSocket.message(ws, raw);
				dashboard.message(ws as Socket, raw);
			},
			close(ws) {
				if (isTerminalSocket(ws)) return terminalSocket.close(ws);
				dashboard.close(ws as Socket);
			},
		},
	});
} catch (err) {
	console.error(`omp-agents: cannot listen on ${HOSTNAME}:${PORT}: ${errorText(err)}`);
	console.error("Set PORT to use another port.");
	process.exit(1);
}

// Also on a crash or `process.exit`, so a server that exits unannounced leaves no lock and no unwritten store; a killed one leaves a stale lock that the next server takes over.
process.on("exit", () => dashboard.exited());
await dashboard.start(server);
console.log(listeningLine(PORT, ompVersion));
console.log(`Serving ${describeServed(served)}`);
console.log(`Sign in at ${originOf(PORT)}/?token=${token}`);
console.log(`The access token is in ${displayPath(tokenFile)}; delete the file and restart to rotate it.`);

/**
 * Lets go of the sessions started here, which run on, and stops the server, then exits, or with `rerun` runs this server's own command again
 * in this process: the same pid, port, environment, and standard streams, so a terminal keeps its job and the desktop
 * shell its child, and the new server loads the checkout as it is now. SIGINT and SIGTERM may both arrive, or one during
 * a restart; the later finds the shutdown already under way, and a signal or the shell's pipe ending cancels the rerun.
 */
let shuttingDown: Promise<void> | undefined;
let rerun = false;
function shutdown(): Promise<void> {
	shuttingDown ??= (async () => {
		await dashboard.stop();
		server.stop(true);
		// SelfUpdate offers no restart where execve is missing, as on Windows.
		if (!rerun || !process.execve) process.exit(0);
		// The owner lock stays: it names this pid and port, which the new server keeps, so no other server takes over the routines meanwhile.
		try {
			process.execve(process.execPath, [process.execPath, ...process.argv.slice(1)], process.env);
		} catch (err) {
			console.error(`omp-agents: cannot restart: ${errorText(err)}`);
			process.exit(1);
		}
	})();
	return shuttingDown;
}

/** **Update dashboard**'s restart; a shutdown already under way stays one. */
function restart(): void {
	rerun = shuttingDown === undefined;
	void shutdown();
}

function stop(): void {
	rerun = false;
	void shutdown();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// The desktop shell holds the server's stdin open and never writes to it; when the shell dies, even by SIGKILL, the pipe ends.
if (process.env.OMP_AGENTS_PARENT === "stdin") {
	process.stdin.on("end", stop);
	process.stdin.resume();
}
