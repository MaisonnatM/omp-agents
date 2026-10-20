import { expect, test } from "bun:test";
import { refuseUntil } from "./http";

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
