/** The dashboard server: builds the {@link Dashboard}, serves its HTTP API, page, and sockets, then sets it following omp's files and registry. */
import type { Server, ServerWebSocket } from "bun";
import { errorText } from "./json";
import { ompVersion } from "./omp/install";
import { displayPath, tokenFile } from "./paths";
import { HOSTNAME, listeningLine, originOf, portFromEnv } from "./server/address";
import { loadToken } from "./server/auth";
import { Dashboard } from "./server/dashboard";
import { fail, guardsFor } from "./server/http";
import { buildPage, servePage } from "./server/page";
import { terminalFor, type TerminalSocket, type TerminalSocketData, terminalSocket } from "./server/terminal-socket";
import type { Socket, SocketData } from "./server/views";

const PORT = portFromEnv();
const token = loadToken(tokenFile);
const guards = guardsFor(PORT, token);
const page = await buildPage();
const dashboard = new Dashboard(PORT);

/** A socket is the dashboard's own, which watches views, or a terminal tab's, which carries one shell. */
type AnySocketData = SocketData | TerminalSocketData;
const isTerminalSocket = (ws: ServerWebSocket<AnySocketData>): ws is TerminalSocket => "terminal" in ws.data;

const NOT_A_WEBSOCKET = (): Response => new Response("expected a websocket", { status: 426 });

function upgrade(req: Request, srv: Server<AnySocketData>): Response | undefined {
	const refused = guards.admitSocket(req);
	if (refused) return refused;
	return srv.upgrade(req, { data: { views: new Map() } }) ? undefined : NOT_A_WEBSOCKET();
}

async function upgradeTerminal(req: Request, srv: Server<AnySocketData>): Promise<Response | undefined> {
	const refused = guards.admitSocket(req);
	if (refused) return refused;
	const params = new URL(req.url).searchParams;
	const terminal = await terminalFor(dashboard.terminals, params);
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
		routes: dashboard.routes(guards),
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
console.log(`Sign in at ${originOf(PORT)}/?token=${token}`);
console.log(`The access token is in ${displayPath(tokenFile)}; delete the file and restart to rotate it.`);

/** SIGINT and SIGTERM may both arrive; the second finds the shutdown already under way. */
let shuttingDown: Promise<void> | undefined;
function shutdown(): Promise<void> {
	shuttingDown ??= (async () => {
		await dashboard.stop();
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
