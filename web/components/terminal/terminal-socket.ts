import type { TerminalClientMsg } from "../../../src/shared/terminals";

/** Sends commands to a terminal socket, retaining a close requested before it connects. */
export function terminalSender(socket: WebSocket): (msg: TerminalClientMsg) => void {
	let closing = false;
	socket.addEventListener("open", () => {
		if (closing) socket.send(JSON.stringify({ t: "kill" } satisfies TerminalClientMsg));
	}, { once: true });
	return msg => {
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
		else if (socket.readyState === WebSocket.CONNECTING && msg.t === "kill") closing = true;
	};
}
