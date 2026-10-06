import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMsg } from "../shared/protocol";
import type { LiveView } from "../shared/sessions";
import type { Item } from "../shared/transcript";
import { type Socket, type SocketData, Views } from "./views";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const text = (value: string) => ({ type: "text", text: value });
const assistant = (timestamp: number, content: unknown[], extra: Record<string, unknown> = {}) => ({ role: "assistant", timestamp, content, ...extra });
const line = (entry: object): string => `${JSON.stringify(entry)}\n`;
const userEntry = (id: string, timestamp: number, content: string) => line({ type: "message", id, message: { role: "user", timestamp, content } });
const replyEntry = (id: string, message: object) => line({ type: "message", id, message });
const streamed = (timestamp: number, reply: string) => ({ type: "message_update", assistantMessageEvent: { partial: assistant(timestamp, [text(reply)]) } });

const main = (instanceId: string): LiveView => ({ kind: "live", instanceId, agentId: null });
const sub = (instanceId: string, agentId: string): LiveView => ({ kind: "live", instanceId, agentId });

/** A socket that records the transcripts the server sends it, and the topics it follows. `work` and `media` messages, which go along with each, are left out. */
function socket() {
	const sent: ServerMsg[] = [];
	const topics = new Set<string>();
	const ws = {
		data: { views: new Map() } as SocketData,
		send: (raw: string) => {
			const msg: ServerMsg = JSON.parse(raw);
			if (msg.t !== "work" && msg.t !== "media") sent.push(msg);
		},
		subscribe: (topic: string) => void topics.add(topic),
		unsubscribe: (topic: string) => void topics.delete(topic),
	};
	return { ws: ws as unknown as Socket, sent, topics };
}

/** Views over files that tests name per view, publishing their transcripts into a list that a test can wait on; `work`, `plan`, and `media` messages are left out. */
function setup() {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-views-"));
	roots.push(root);
	const paths = new Map<string, string | null>();
	const published: { topic: string; msg: ServerMsg }[] = [];
	let waiter: { count: number; resolve: () => void } | null = null;
	const views = new Views(
		view => (view.kind === "live" ? (paths.get(`${view.instanceId}:${view.agentId ?? ""}`) ?? null) : null),
		(topic, msg) => {
			if (msg.t === "work" || msg.t === "media") return;
			published.push({ topic, msg });
			if (waiter && published.length >= waiter.count) waiter.resolve();
		},
	);
	/** Settles once `count` messages have been published in all. */
	const untilPublished = (count: number): Promise<void> => {
		if (published.length >= count) return Promise.resolve();
		const { promise, resolve } = Promise.withResolvers<void>();
		waiter = { count, resolve };
		return promise;
	};
	const itemsOf = (index: number): { reset: boolean; items: Item[] } => {
		const msg = published[index]?.msg;
		if (msg?.t !== "items") throw new Error(`published[${index}] is not an items message`);
		return { reset: msg.reset, items: msg.items };
	};
	return { root, paths, published, views, untilPublished, itemsOf };
}

describe("Views", () => {
	test("the file's copy of a streamed reply replaces it in place, and a late event cannot undo it", async () => {
		const { root, paths, views, untilPublished, itemsOf, published } = setup();
		const file = join(root, "session.jsonl");
		writeFileSync(file, userEntry("e1", 100, "say pong"));
		paths.set("a:", file);
		const { ws } = socket();

		views.watch(ws, [main("a")]);
		await untilPublished(1);
		expect(itemsOf(0)).toEqual({
			reset: true,
			items: [{ id: "m100", kind: "user", text: "say pong", skill: null, from: null, entryId: "e1" }],
		});

		// The reply streams (held back for the publish window), then the file catches up with the finished message.
		views.applyEvent("a", streamed(200, "po"));
		appendFileSync(file, replyEntry("e2", assistant(200, [text("pong")], { stopReason: "stop" })));
		views.poke(file);
		await untilPublished(2);
		expect(itemsOf(1)).toEqual({ reset: false, items: [{ id: "m200:0", kind: "assistant", text: "pong", streaming: false, suggestions: [] }] });

		// A straggling update from the relay arrives after the file settled the message.
		views.applyEvent("a", streamed(200, "pon"));
		views.note("a", null, "warning", "barrier");
		await untilPublished(3);
		expect(published).toHaveLength(3);
		expect(itemsOf(2).items).toEqual([{ id: "notice1", kind: "notice", level: "warning", text: "barrier" }]);
	});

	test("a fresh session's prompt shows from its live event until the file catches up, and stays ahead of the reply", async () => {
		const { root, paths, views, untilPublished, itemsOf, published } = setup();
		// omp writes the session file only with its first reply; until then the path is known but the file is missing.
		const file = join(root, "fresh.jsonl");
		paths.set("a:", file);
		const { ws } = socket();

		views.watch(ws, [main("a")]);
		await untilPublished(1);
		expect(itemsOf(0)).toEqual({ reset: true, items: [] });

		views.applyEvent("a", { type: "message_end", message: { role: "user", timestamp: 600, content: "say pong" } });
		await untilPublished(2);
		expect(itemsOf(1).items).toEqual([{ id: "m600", kind: "user", text: "say pong", skill: null, from: null, entryId: null }]);

		writeFileSync(file, userEntry("e1", 600, "say pong") + replyEntry("e2", assistant(610, [text("pong")], { stopReason: "stop" })));
		views.poke(file);
		await untilPublished(3);
		const items = published.slice(2).flatMap((_, index) => itemsOf(index + 2).items);
		expect(items).toEqual(
			expect.arrayContaining([
				{ id: "m600", kind: "user", text: "say pong", skill: null, from: null, entryId: "e1" },
				{ id: "m610:0", kind: "assistant", text: "pong", streaming: false, suggestions: [] },
			]),
		);
		expect(items.filter(item => item.id === "m600")).toHaveLength(1);
	});

	test("live events and notes reach only the view they belong to", async () => {
		const { root, paths, views, untilPublished, published } = setup();
		const mainFile = join(root, "main.jsonl");
		const subFile = join(root, "main", "s1.jsonl");
		mkdirSync(join(root, "main"));
		writeFileSync(mainFile, "");
		writeFileSync(subFile, "");
		paths.set("a:", mainFile);
		paths.set("a:s1", subFile);
		const { ws } = socket();
		views.watch(ws, [main("a"), sub("a", "s1")]);
		await untilPublished(2);

		// The host's agent events are the main agent's; a subagent's pane takes none of them.
		views.applyEvent("a", { type: "message_end", message: { role: "user", timestamp: 5, content: "hi" } });
		await untilPublished(3);
		views.note("a", "s1", "error", "agent s1: gone");
		await untilPublished(4);

		expect(published.slice(2).map(({ topic, msg }) => [topic, msg.t === "items" ? msg.items.map(item => item.kind) : []])).toEqual([
			["view:live:a:", ["user"]],
			["view:live:a:s1", ["notice"]],
		]);
	});

	test("an event for a session no socket watches, or whose file is not known yet, is dropped", () => {
		const { paths, views, published } = setup();
		const { ws, sent } = socket();
		views.applyEvent("nobody", { type: "message_end", message: { role: "user", timestamp: 5, content: "hi" } });

		paths.set("a:", null);
		views.watch(ws, [main("a")]);
		expect(sent).toEqual([{ t: "items", view: main("a"), reset: true, items: [] }]);
		views.applyEvent("a", { type: "message_end", message: { role: "user", timestamp: 5, content: "hi" } });
		views.note("a", null, "error", "lost");
		expect(published).toEqual([]);
	});

	test("a view whose file appears later starts streaming on sync, and one whose file goes away is emptied", async () => {
		const { root, paths, views, untilPublished, itemsOf, published } = setup();
		const { ws, sent } = socket();
		paths.set("a:", null);
		views.watch(ws, [main("a")]);
		expect(sent).toHaveLength(1);

		const first = join(root, "first.jsonl");
		writeFileSync(first, userEntry("e1", 100, "one"));
		paths.set("a:", first);
		views.sync();
		await untilPublished(1);
		expect(itemsOf(0).reset).toBe(true);
		expect(itemsOf(0).items.map(item => item.id)).toEqual(["m100"]);

		// The host switched to another session (/new): the view restarts from the new file.
		const second = join(root, "second.jsonl");
		writeFileSync(second, userEntry("e9", 900, "two"));
		paths.set("a:", second);
		views.sync();
		await untilPublished(2);
		expect(itemsOf(1)).toEqual({
			reset: true,
			items: [{ id: "m900", kind: "user", text: "two", skill: null, from: null, entryId: "e9" }],
		});

		paths.set("a:", null);
		views.sync();
		expect(published.at(-1)).toEqual({ topic: "view:live:a:", msg: { t: "items", view: main("a"), reset: true, items: [] } });
	});

	test("a socket that joins a view another socket already shows gets its current items at once, and the view stops when the last socket leaves", async () => {
		const { root, paths, views, untilPublished, published } = setup();
		const file = join(root, "session.jsonl");
		writeFileSync(file, userEntry("e1", 100, "hello"));
		paths.set("a:", file);
		const first = socket();
		const second = socket();

		views.watch(first.ws, [main("a")]);
		await untilPublished(1);
		views.watch(second.ws, [main("a")]);
		expect(second.sent).toEqual([
			{ t: "items", view: main("a"), reset: true, items: [{ id: "m100", kind: "user", text: "hello", skill: null, from: null, entryId: "e1" }] },
		]);
		expect(second.topics).toEqual(new Set(["view:live:a:"]));
		expect(published).toHaveLength(1);

		// One socket leaving keeps the view going for the other.
		views.watch(first.ws, []);
		expect(first.topics.size).toBe(0);
		views.note("a", null, "warning", "still here");
		await untilPublished(2);

		views.watch(second.ws, []);
		views.note("a", null, "warning", "nobody home");
		views.poke(file);
		await Promise.resolve();
		expect(published).toHaveLength(2);
	});

	test("a change reported only for omp's lock sidecar re-reads every open transcript in that directory", async () => {
		const { root, paths, views, untilPublished, published, itemsOf } = setup();
		mkdirSync(join(root, "project"));
		const one = join(root, "project", "one.jsonl");
		const two = join(root, "project", "two.jsonl");
		writeFileSync(one, userEntry("e1", 100, "a"));
		writeFileSync(two, userEntry("e2", 200, "b"));
		paths.set("a:", one);
		paths.set("b:", two);
		const { ws } = socket();
		views.watch(ws, [main("a"), main("b")]);
		await untilPublished(2);

		appendFileSync(one, userEntry("e3", 300, "c"));
		appendFileSync(two, userEntry("e4", 400, "d"));
		views.poke(join(root, "project", ".one.jsonl.lock"));
		await untilPublished(4);

		expect(published.slice(2).map(({ topic }) => topic).sort()).toEqual(["view:live:a:", "view:live:b:"]);
		expect([itemsOf(2), itemsOf(3)].flatMap(({ items }) => items.map(item => item.id)).sort()).toEqual(["m300", "m400"]);
	});

	test("a session's view gets its subagents' images as they arrive, a socket that joins later gets them at once, and losing the file clears them", async () => {
		const root = mkdtempSync(join(tmpdir(), "omp-agents-views-"));
		roots.push(root);
		const file = join(root, "session.jsonl");
		const smoke = join(root, "session", "Smoke.jsonl");
		mkdirSync(join(root, "session"));
		writeFileSync(file, userEntry("e1", 100, "take a screenshot"));
		writeFileSync(smoke, "");
		const image = (id: string, hash: string): string =>
			line({ type: "message", message: { role: "toolResult", toolCallId: id, toolName: "eval", timestamp: 1, content: [{ type: "image", data: `blob:sha256:${hash}`, mimeType: "image/webp" }] } });
		const srcOf = (hash: string): string => `/api/image?hash=${hash}&type=image%2Fwebp`;

		let path: string | null = file;
		const lists: (string | null)[][] = [];
		let waiter: (() => void) | null = null;
		const views = new Views(
			() => path,
			(_topic, msg) => {
				if (msg.t !== "media") return;
				lists.push(msg.media.map(media => media.agentId));
				waiter?.();
			},
		);
		const nextList = (): Promise<void> => {
			const { promise, resolve } = Promise.withResolvers<void>();
			waiter = resolve;
			return promise;
		};

		const loaded = nextList();
		views.watch(socket().ws, [main("a")]);
		await loaded;
		expect(lists).toEqual([[]]);

		appendFileSync(smoke, image("c1", "a".repeat(64)));
		const added = nextList();
		views.poke(smoke);
		await added;
		expect(lists.at(-1)).toEqual(["Smoke"]);

		const late: ServerMsg[] = [];
		const joiner = {
			data: { views: new Map() } as SocketData,
			send: (raw: string) => void late.push(JSON.parse(raw)),
			subscribe: () => {},
			unsubscribe: () => {},
		} as unknown as Socket;
		views.watch(joiner, [main("a")]);
		expect(late.find(msg => msg.t === "media")).toEqual({ t: "media", view: main("a"), reset: true, media: [{ src: srcOf("a".repeat(64)), agentId: "Smoke", tool: "eval", summary: "", at: 1 }] });

		path = null;
		views.sync();
		expect(lists.at(-1)).toEqual([]);
	});
});
