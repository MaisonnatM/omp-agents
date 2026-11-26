import { expect, test } from "bun:test";
import type { ClientFrame, ClientMsg } from "../src/shared/protocol";
import { Outbox, type OutboxSocket } from "./outbox";

/** A socket in `readyState` that keeps every frame sent on it. */
function socket(readyState: OutboxSocket["readyState"]) {
	const frames: ClientFrame[] = [];
	const ws: OutboxSocket = { readyState, send: data => frames.push(JSON.parse(String(data)) as ClientFrame) };
	return { ws, frames };
}

const edit: ClientMsg = { t: "edit-prompt", instanceId: "i1", entryId: "e1", text: "typed offline" };

test("a write made while the socket is closed goes out after the next socket's resume and settles on its answer", async () => {
	const closed = socket(WebSocket.CLOSED);
	let current = closed.ws;
	const outbox = new Outbox(() => current, () => {});
	let settled = false;
	const done = outbox.write(edit).then(() => (settled = true));
	expect(closed.frames).toEqual([]);

	const reopened = socket(WebSocket.OPEN);
	current = reopened.ws;
	outbox.resume(reopened.ws);
	expect(reopened.frames).toEqual([{ t: "resume", frames: [] }, { ...edit, ack: 0, floor: 0 }]);
	expect(settled).toBe(false);

	outbox.settle(0, null);
	await done;
	expect(settled).toBe(true);
});

test("a frame a closed socket carried is asked for in the resume, not sent again as new", () => {
	const first = socket(WebSocket.OPEN);
	const outbox = new Outbox(() => first.ws, () => {});
	void outbox.write(edit);
	const next = socket(WebSocket.OPEN);
	outbox.resume(next.ws);
	expect(next.frames).toEqual([{ t: "resume", frames: [{ ...edit, ack: 0, floor: 0 }] }]);
});

test("a request rejects at once while disconnected, and a write rejects with the server's error", async () => {
	const open = socket(WebSocket.OPEN);
	let current: OutboxSocket | null = null;
	const outbox = new Outbox(() => current, () => {});
	await expect(outbox.request(edit)).rejects.toThrow("Not connected to the server.");
	current = open.ws;
	const done = outbox.write(edit);
	outbox.settle(0, "The session is gone.");
	await expect(done).rejects.toThrow("The session is gone.");
});
