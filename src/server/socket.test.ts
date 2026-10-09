import { describe, expect, test } from "bun:test";
import type { ServerMsg } from "../shared/protocol";
import { createClientHandler, type SocketEnv } from "./socket";
import type { Socket, SocketData } from "./views";

function socket() {
	const sent: ServerMsg[] = [];
	const ws = { data: { views: new Map() } as SocketData, send: (raw: string) => void sent.push(JSON.parse(raw)) };
	return { ws: ws as unknown as Socket, sent };
}

describe("createClientHandler", () => {
	test("a tagged message gets done once its handler settles, and an untagged one gets nothing", async () => {
		const { ws, sent } = socket();
		const response = Promise.withResolvers<void>();
		const handle = createClientHandler({ end: (_instanceId: string) => response.promise } as SocketEnv);
		const ending = handle(ws, { t: "end", instanceId: "i1", ack: 3 });
		await Promise.resolve();
		expect(sent).toEqual([]);
		response.resolve();
		await ending;
		await handle(ws, { t: "end", instanceId: "i2" });
		expect(sent).toEqual([{ t: "done", ack: 3, error: null }]);
	});

	test("a tagged message whose handler throws gets done with the error, and the handler still rejects", async () => {
		const { ws, sent } = socket();
		const handle = createClientHandler({
			end: async (_instanceId: string): Promise<void> => {
				throw new Error("The worktree is busy.");
			},
		} as SocketEnv);
		await expect(handle(ws, { t: "end", instanceId: "i1", ack: 4 })).rejects.toThrow("The worktree is busy.");
		await expect(handle(ws, { t: "end", instanceId: "i1" })).rejects.toThrow("The worktree is busy.");
		expect(sent).toEqual([{ t: "done", ack: 4, error: "The worktree is busy." }]);
	});
});
