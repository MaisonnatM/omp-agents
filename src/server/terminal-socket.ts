/** `/ws/terminal`: one socket per terminal tab, carrying the shell's output and what you type as binary frames. */
import type { ServerWebSocket } from "bun";
import { directoryOf } from "../paths";
import type { TerminalServerMsg } from "../shared/terminals";
import { MAX_TERMINALS, type Terminal, type Terminals } from "../terminals";
import { fail } from "./http";
import { parseTerminalMsg, parseTerminalQuery } from "./wire";

export interface TerminalSocketData {
	terminal: Terminal;
	/** Stops the shell's output reaching this socket; set once the socket opens. */
	detach: (() => void) | null;
}

export type TerminalSocket = ServerWebSocket<TerminalSocketData>;

/**
 * The shell a `/ws/terminal` upgrade names: `?id=` an open one, which a reloaded page reattaches to, or `?cwd=` a new one there.
 * A refusal when the query names neither, the shell has exited, `cwd` is no directory, such as a removed worktree, or {@link MAX_TERMINALS} shells run.
 */
export async function terminalFor(terminals: Terminals, params: URLSearchParams): Promise<Terminal | Response> {
	const target = parseTerminalQuery(params);
	if (!target) return fail(400, "Name a terminal with ?id=, or open one with ?cwd=&cols=&rows=.");
	const query = target.ok;
	if ("id" in query) return terminals.get(query.id) ?? fail(404, "That terminal has exited.");
	const cwd = await directoryOf(query.cwd);
	if (!cwd) return fail(404, `${query.cwd.trim()} is not a directory.`);
	return terminals.open(cwd, query) ?? fail(429, `${MAX_TERMINALS} terminals are open. Close one to open another.`);
}

const sendMsg = (ws: TerminalSocket, msg: TerminalServerMsg): void => void ws.send(JSON.stringify(msg));

export const terminalSocket = {
	open(ws: TerminalSocket): void {
		const { terminal } = ws.data;
		sendMsg(ws, { t: "opened", terminal: terminal.info });
		ws.data.detach = terminal.attach({
			output: chunk => void ws.sendBinary(chunk),
			exit(code) {
				sendMsg(ws, { t: "exit", code });
				ws.close();
			},
		});
	},
	message(ws: TerminalSocket, raw: string | Buffer): void {
		const { terminal } = ws.data;
		if (typeof raw !== "string") return terminal.write(raw);
		const msg = parseTerminalMsg(raw)?.ok;
		if (msg?.t === "resize") terminal.resize(msg.cols, msg.rows);
		else if (msg?.t === "kill") terminal.kill();
	},
	close(ws: TerminalSocket): void {
		ws.data.detach?.();
	},
};
