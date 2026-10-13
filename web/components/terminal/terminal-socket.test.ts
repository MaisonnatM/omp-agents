import { expect, test } from "bun:test";
import { terminalFor, terminalSocket, type TerminalSocketData } from "../../../src/server/terminal-socket";
import { terminalSocketPath } from "../../../src/shared/terminals";
import { Terminals } from "../../../src/terminals";
import { terminalSender } from "./terminal-socket";

/** Serves `/ws/terminal` over `terminals` as the dashboard does, closes the tab `path` names before its socket connects, and answers the frames it got. */
async function closeBeforeConnecting(terminals: Terminals, path: string): Promise<unknown[]> {
	const server = Bun.serve<TerminalSocketData>({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request, server) {
			const terminal = await terminalFor(terminals, new URL(request.url).searchParams);
			if (terminal instanceof Response) return terminal;
			if (!server.upgrade(request, { data: { terminal, detach: null } })) return new Response("Cannot attach", { status: 400 });
		},
		websocket: terminalSocket,
	});
	const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
	const closed = Promise.withResolvers<void>();
	const frames: unknown[] = [];
	socket.onmessage = ({ data }: MessageEvent<string | ArrayBuffer>) => {
		if (typeof data === "string") frames.push(JSON.parse(data));
	};
	socket.onclose = () => closed.resolve();
	try {
		expect(socket.readyState).toBe(WebSocket.CONNECTING);
		terminalSender(socket)({ t: "kill" });
		await closed.promise;
		return frames;
	} finally {
		socket.close();
		await server.stop(true);
	}
}

async function withShells(run: (terminals: Terminals) => Promise<void>): Promise<void> {
	const shell = process.env.SHELL;
	process.env.SHELL = "/bin/sh";
	const terminals = new Terminals();
	try {
		await run(terminals);
	} finally {
		terminals.dispose();
		if (shell === undefined) delete process.env.SHELL;
		else process.env.SHELL = shell;
	}
}

test("closing a restored shell before its socket connects still exits the shell and removes it from the inventory", () =>
	withShells(async terminals => {
		const terminal = terminals.open(import.meta.dir, { cols: 80, rows: 24 });
		if (!terminal) throw new Error("The terminal was refused.");
		const frames = await closeBeforeConnecting(terminals, terminalSocketPath({ id: terminal.id }));
		expect(frames).toEqual([{ t: "opened", terminal: terminal.info }, { t: "exit", code: null }]);
		expect(terminals.list()).toEqual([]);
	}));

test("closing a new tab before the server opens its shell still exits the shell it opens", () =>
	withShells(async terminals => {
		const frames = await closeBeforeConnecting(terminals, terminalSocketPath({ cwd: import.meta.dir, cols: 80, rows: 24 }));
		expect(frames).toMatchObject([{ t: "opened", terminal: { cwd: import.meta.dir } }, { t: "exit", code: null }]);
		expect(terminals.list()).toEqual([]);
	}));
