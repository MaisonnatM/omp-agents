import { expect, test } from "bun:test";
import { terminalSocket, type TerminalSocketData } from "../../../src/server/terminal-socket";
import { terminalSocketPath } from "../../../src/shared/terminals";
import { Terminals } from "../../../src/terminals";
import { terminalSender } from "./terminal-socket";

test("closing a restored shell before its socket connects still exits the shell and removes it from the inventory", async () => {
	const shell = process.env.SHELL;
	process.env.SHELL = "/bin/sh";
	const terminals = new Terminals();
	const terminal = terminals.open(import.meta.dir, { cols: 80, rows: 24 });
	if (!terminal) throw new Error("The terminal was refused.");
	const server = Bun.serve<TerminalSocketData>({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			if (!server.upgrade(request, { data: { terminal, detach: null } })) return new Response("Cannot attach", { status: 400 });
		},
		websocket: terminalSocket,
	});
	const socket = new WebSocket(`ws://127.0.0.1:${server.port}${terminalSocketPath({ id: terminal.id })}`);
	const closed = Promise.withResolvers<void>();
	const frames: unknown[] = [];
	socket.onmessage = ({ data }: MessageEvent<string | ArrayBuffer>) => {
		if (typeof data === "string") frames.push(JSON.parse(data));
	};
	socket.onclose = () => closed.resolve();
	try {
		expect(socket.readyState).toBe(WebSocket.CONNECTING);
		const send = terminalSender(socket);
		send({ t: "kill" });
		await closed.promise;
		expect(frames).toEqual([{ t: "opened", terminal: terminal.info }, { t: "exit", code: null }]);
		expect(terminals.list()).toEqual([]);
	} finally {
		socket.close();
		terminals.dispose();
		await server.stop(true);
		if (shell === undefined) delete process.env.SHELL;
		else process.env.SHELL = shell;
	}
});
