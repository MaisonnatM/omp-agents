/** `/ws/terminal`: one socket per terminal tab, carrying the shell's output and what you type as binary frames. */
import { homedir } from "node:os";
import type { ServerWebSocket } from "bun";
import { directoryOf } from "../paths";
import type { TerminalServerMsg } from "../shared/terminals";
import type { Terminal, Terminals } from "../terminals";
import { fail } from "./http";
import { parseTerminalMsg, parseTerminalQuery } from "./wire";

export interface TerminalSocketData {
	terminal: Terminal;
	/** Stops the shell's output reaching this socket; set once the socket opens. */
	detach: (() => void) | null;
}

export type TerminalSocket = ServerWebSocket<TerminalSocketData>;

/**
 * The shell a `/ws/terminal` upgrade names: `?id=` an open one, `?cwd=` a new one there, or the home directory when
 * `cwd` is no directory, such as a removed worktree. A refusal when the query names neither or the shell has exited.
 */
export function terminalFor(terminals: Terminals, params: URLSearchParams): Terminal | Response {
	const target = parseTerminalQuery(params);
	if (!target) return fail(400, "Name a terminal with ?id=, or open one with ?cwd=&cols=&rows=.");
	if ("id" in target) return terminals.get(target.id) ?? fail(404, "That terminal has exited.");
	return terminals.open(directoryOf(target.cwd) ?? homedir(), target);
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
		const msg = parseTerminalMsg(raw);
		if (msg?.t === "resize") terminal.resize(msg.cols, msg.rows);
		else if (msg?.t === "kill") terminal.kill();
	},
	close(ws: TerminalSocket): void {
		ws.data.detach?.();
	},
};
