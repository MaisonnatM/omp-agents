import { describe, expect, test, vi } from "bun:test";
import type { AckedFrame, ServerMsg } from "../shared/protocol";
import type { LiveView } from "../shared/sessions";
import { FORGOTTEN, type Peer, RequestLedger } from "./request-ledger";
import type { Socket, SocketData } from "./views";

const PAGE = "4b1f7c9e-0d2a-4e8b-9f61-2a7c3d5e8b10";
const view: LiveView = { kind: "live", instanceId: "i1", agentId: null };

function socket(watched: LiveView[] = []) {
	const sent: ServerMsg[] = [];
	const data: SocketData = { views: new Map(watched.map(v => [v.instanceId, v])), pageId: PAGE };
	const ws = { data, send: (raw: string) => void sent.push(JSON.parse(raw)) } as unknown as Socket;
	return { ws, sent };
}

/** A socket of the page that opened and sent its `resume` with `frames`, as each socket the page opens does. */
async function connect(ledger: RequestLedger, frames: AckedFrame[] = [], watched: LiveView[] = []) {
	const peer = socket(watched);
	ledger.open(peer.ws);
	await ledger.handle(peer.ws, { t: "resume", frames });
	return peer;
}

const end = (ack: number, floor = ack): AckedFrame => ({ t: "end", instanceId: "i1", ack, floor });
const withdrawn: ServerMsg = { t: "withdrawn", view, reqId: 0, messages: [{ text: "hi", images: [] }] };
const ignore = (): void => {};

describe("RequestLedger", () => {
	test("a tagged message gets done once its handler settles, and an untagged one gets nothing", async () => {
		const response = Promise.withResolvers<void>();
		const ledger = new RequestLedger(() => response.promise, ignore);
		const { ws, sent } = await connect(ledger);
		const ending = ledger.handle(ws, end(3));
		await Promise.resolve();
		expect(sent).toEqual([]);
		response.resolve();
		await ending;
		await ledger.handle(ws, { t: "end", instanceId: "i2" });
		expect(sent).toEqual([{ t: "done", ack: 3, error: null }]);
	});

	test("a handler that throws gets done with the error, and reports it on its one run", async () => {
		const failures: unknown[] = [];
		const ledger = new RequestLedger(
			async () => {
				throw new Error("The worktree is busy.");
			},
			(t, error) => failures.push([t, (error as Error).message]),
		);
		const first = await connect(ledger);
		await ledger.handle(first.ws, end(4));
		ledger.close(first.ws);

		const second = await connect(ledger, [end(4)]);
		expect(failures).toEqual([["end", "The worktree is busy."]]);
		expect(second.sent).toEqual([{ t: "done", ack: 4, error: "The worktree is busy." }]);
	});

	test("every request a resume runs reports its own failure", async () => {
		const failures: unknown[] = [];
		const ledger = new RequestLedger(
			async (_peer, msg) => {
				throw new Error(`failed ${(msg as AckedFrame).ack}`);
			},
			(t, error) => failures.push([t, (error as Error).message]),
		);
		ledger.close((await connect(ledger)).ws);
		await connect(ledger, [end(0), end(1, 0)]);
		expect(failures).toEqual([
			["end", "failed 0"],
			["end", "failed 1"],
		]);
	});

	test("a resume resends what a request answered while the page was away, and runs it no second time", async () => {
		let runs = 0;
		const ledger = new RequestLedger(async (peer: Peer) => {
			runs++;
			peer.send({ t: "started", reqId: 7, result: { ok: false, error: "no" } });
			peer.reply("i1", withdrawn);
			peer.reply("i2", { ...withdrawn, view: { ...view, instanceId: "i2" } });
		}, ignore);
		const first = await connect(ledger, [], [view]);
		ledger.close(first.ws);
		await ledger.handle(first.ws, end(0));
		expect(first.sent).toEqual([]);

		const second = await connect(ledger, [end(0)], [view]);
		expect(runs).toBe(1);
		expect(second.sent).toEqual([{ t: "started", reqId: 7, result: { ok: false, error: "no" } }, withdrawn, { t: "done", ack: 0, error: null }]);
	});

	test("a request still running when the page reconnects answers on the new socket", async () => {
		const response = Promise.withResolvers<void>();
		const ledger = new RequestLedger(() => response.promise, ignore);
		const first = await connect(ledger);
		const ending = ledger.handle(first.ws, end(1));
		ledger.close(first.ws);

		const second = await connect(ledger, [end(1)]);
		expect(second.sent).toEqual([]);
		response.resolve();
		await ending;
		expect(first.sent).toEqual([]);
		expect(second.sent).toEqual([{ t: "done", ack: 1, error: null }]);
	});

	test("a resume runs a request the server never got", async () => {
		const ran: number[] = [];
		const ledger = new RequestLedger(async (_peer, msg) => void ran.push((msg as AckedFrame).ack), ignore);
		const first = await connect(ledger);
		await ledger.handle(first.ws, end(0));
		ledger.close(first.ws);

		const second = await connect(ledger, [end(0), end(1, 0)]);
		expect(ran).toEqual([0, 1]);
		expect(second.sent).toEqual([
			{ t: "done", ack: 0, error: null },
			{ t: "done", ack: 1, error: null },
		]);
	});

	test("a page's first resume on this server refuses every request it waits on, on every socket, and runs none", async () => {
		let runs = 0;
		const ledger = new RequestLedger(async () => void runs++, ignore);
		const first = await connect(ledger, [end(2), end(3, 2)]);
		ledger.close(first.ws);
		const second = await connect(ledger, [end(2), end(3, 2)]);
		expect(runs).toBe(0);
		for (const { sent } of [first, second]) {
			expect(sent).toEqual([
				{ t: "done", ack: 2, error: FORGOTTEN },
				{ t: "done", ack: 3, error: FORGOTTEN },
			]);
		}
	});

	test("a page away longer than an hour reads as one the server never heard", async () => {
		vi.useFakeTimers();
		try {
			let runs = 0;
			const ledger = new RequestLedger(async () => void runs++, ignore);
			const first = await connect(ledger);
			await ledger.handle(first.ws, end(0));
			ledger.close(first.ws);
			vi.advanceTimersByTime(60 * 60_000);

			const second = await connect(ledger, [end(0)]);
			expect(runs).toBe(1);
			expect(second.sent).toEqual([{ t: "done", ack: 0, error: FORGOTTEN }]);
		} finally {
			vi.useRealTimers();
		}
	});
});
