import { expect, test } from "bun:test";
import type { Guards } from "./http";
import { guardsFor, refuseUntil } from "./http";

// The DOM constructor type hides Bun's documented client header/protocol options.
declare const WebSocket: { new(url: string, options?: Bun.WebSocketOptions): globalThis.WebSocket };

test("the dashboard socket is refused while the sessions are still attaching, and accepted once they are", async () => {
	const reattached = Promise.withResolvers<void>();
	const notReattached = refuseUntil(reattached.promise, "Still attaching.");
	using server = Bun.serve({
		port: 0,
		fetch: (req, srv) => notReattached() ?? (srv.upgrade(req) ? undefined : new Response("expected a websocket", { status: 426 })),
		websocket: { message() {} },
	});
	const connect = (): Promise<"open" | "refused"> => {
		const { promise, resolve } = Promise.withResolvers<"open" | "refused">();
		const ws = new WebSocket(`ws://${server.hostname}:${server.port}/ws`);
		ws.onopen = () => {
			ws.close();
			resolve("open");
		};
		ws.onerror = () => resolve("refused");
		return promise;
	};

	const refusal = notReattached();
	expect([await connect(), refusal?.status, await refusal?.json()]).toEqual(["refused", 503, { error: "Still attaching." }]);
	reattached.resolve();
	await reattached.promise;
	expect(await connect()).toBe("open");
});

test("a local program opens the dashboard socket with the Bearer header as with the subprotocol", async () => {
	const TOKEN = "socket-test-token";
	let guards: Guards | undefined;
	using server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (req, srv) => {
			if (!guards) throw new Error("guards are set before any connection");
			return guards.admitSocket(req) ?? (srv.upgrade(req, { headers: guards.socketHeaders(req) }) ? undefined : new Response("expected a websocket", { status: 426 }));
		},
		websocket: { message() {} },
	});
	const port = Number(server.url.port);
	guards = guardsFor(port, TOKEN);
	const origin = `http://127.0.0.1:${port}`;
	const connect = (init: Bun.WebSocketOptions): Promise<"open" | "refused"> => {
		const { promise, resolve } = Promise.withResolvers<"open" | "refused">();
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, init);
		ws.onopen = () => {
			ws.close();
			resolve("open");
		};
		ws.onerror = () => resolve("refused");
		return promise;
	};

	expect(await connect({ headers: { origin, authorization: `Bearer ${TOKEN}` } })).toBe("open");
	expect(await connect({ headers: { origin }, protocols: ["omp-agents", `bearer.${TOKEN}`] })).toBe("open");
	expect(await connect({ headers: { origin } })).toBe("refused");
});
