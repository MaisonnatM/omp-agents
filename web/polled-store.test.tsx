import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { decoder, fields, isNumber } from "../src/json";
import { createPolledStore, type PolledEntry } from "./polled-store";

const memory = new Map<string, string>();
const storage: Storage = {
	getItem: key => memory.get(key) ?? null,
	setItem: (key, value) => {
		memory.set(key, value);
	},
	removeItem: key => {
		memory.delete(key);
	},
	clear: () => memory.clear(),
	key: () => null,
	get length() {
		return memory.size;
	},
};

let storageDescriptor: PropertyDescriptor | undefined;
let fetchDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
	storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
	memory.clear();
});

function fetchWith(implementation: (url: string, signal: AbortSignal | null | undefined) => Promise<Response>): void {
	jest.spyOn(globalThis, "fetch").mockImplementation(Object.assign(
		(input: RequestInfo | URL, init?: RequestInit) => implementation(String(input), init?.signal),
		{ preconnect: globalThis.fetch.preconnect },
	));
}

const keys: string[] = [];
const decodeN = decoder(fields<{ n: number }>({ n: isNumber }));

function store() {
	const cacheKey = `test.polled.${keys.length}`;
	keys.push(cacheKey);
	return createPolledStore<{ n: number }>({
		url: scope => `/polled/${scope ?? ""}`,
		cache: { key: cacheKey, decode: decodeN },
	});
}

function shown(entry: PolledEntry<{ n: number }>): string {
	return `${entry.read?.data.n ?? "-"}:${entry.refreshing ? "refreshing" : "still"}:${entry.error ?? ""}`;
}

function text(polled: { use(scope: string | null): PolledEntry<{ n: number }> }, scope: string): string {
	function Read() {
		return <span>{shown(polled.use(scope))}</span>;
	}
	return renderToStaticMarkup(<Read />);
}

/** The page's visibility, which a polled store reads on each tick. */
const page = Object.assign(new EventTarget(), { hidden: false });

beforeEach(() => {
	page.hidden = false;
	Object.assign(globalThis, { document: page });
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "document");
	for (const key of keys) localStorage.removeItem(key);
	keys.length = 0;
	mock.restore();
	if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
	else Reflect.deleteProperty(globalThis, "localStorage");
	if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
	else Reflect.deleteProperty(globalThis, "fetch");
});

describe("polled store", () => {
	test("a read that a newer one superseded does not replace the newer answer", async () => {
		const polled = store();
		let finishFirst: (response: Response) => void = () => {};
		const first = new Promise<Response>(resolve => {
			finishFirst = resolve;
		});
		let calls = 0;
		fetchWith(async () => {
			calls += 1;
			if (calls === 1) return first;
			return new Response(JSON.stringify({ n: 2 }), { status: 200 });
		});
		const older = polled.refresh("a");
		const newer = polled.refresh("a");
		finishFirst(new Response(JSON.stringify({ n: 1 }), { status: 200 }));
		await older;
		await newer;
		expect(text(polled, "a")).toBe("<span>2:still:</span>");
	});

	test("a saved answer supersedes an old read and survives a failed refresh in memory and storage", async () => {
		const polled = store();
		const older = Promise.withResolvers<Response>();
		let calls = 0;
		const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => {
			calls += 1;
			if (calls === 1) return new Response(JSON.stringify({ n: 1 }));
			if (calls === 2) return older.promise;
			return new Response(JSON.stringify({ error: "offline" }), { status: 500 });
		}, { preconnect: globalThis.fetch.preconnect }));
		try {
			await polled.refresh("a");
			const stale = polled.refresh("a");
			polled.update(data => ({ n: data.n + 1 }), "a");
			expect(text(polled, "a")).toBe("<span>2:still:</span>");
			older.resolve(new Response(JSON.stringify({ n: 1 })));
			await stale;
			expect(text(polled, "a")).toBe("<span>2:still:</span>");
			await polled.refresh("a");
			expect(text(polled, "a")).toBe("<span>2:still:offline</span>");
			const stored = JSON.parse(memory.get(keys.at(-1)!)!);
			expect(stored.a.data).toEqual({ n: 2 });
		} finally {
			fetch.mockRestore();
		}
	});

	test("independent saved changes compose over the current answer without changing other scopes", async () => {
		const polled = store();
		const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(Object.assign(
			async () => new Response(JSON.stringify({ n: 1 })),
			{ preconnect: globalThis.fetch.preconnect },
		));
		try {
			await Promise.all([polled.refresh("a"), polled.refresh("b")]);
			polled.update(data => ({ n: data.n + 2 }), "a");
			polled.update(data => ({ n: data.n + 3 }), "a");
			expect(text(polled, "a")).toBe("<span>6:still:</span>");
			expect(text(polled, "b")).toBe("<span>1:still:</span>");
		} finally {
			fetch.mockRestore();
		}
	});

	test("reads of two scopes in flight at once both complete, and each refresh aborts only a read of its own scope", async () => {
		const polled = store();
		const pending = new Map<string, { signal: AbortSignal; finish: (n: number) => void }>();
		fetchWith((url, signal) => {
			if (!signal) throw new Error("A polled read must be cancellable.");
			const { promise, resolve, reject } = Promise.withResolvers<Response>();
			signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			pending.set(url, { signal, finish: n => resolve(new Response(JSON.stringify({ n }), { status: 200 })) });
			return promise;
		});
		const a = polled.refresh("a");
		const b = polled.refresh("b");
		expect(pending.get("/polled/a")?.signal.aborted).toBe(false);
		expect(pending.get("/polled/b")?.signal.aborted).toBe(false);
		pending.get("/polled/a")?.finish(1);
		pending.get("/polled/b")?.finish(2);
		await Promise.all([a, b]);
		expect(text(polled, "a")).toBe("<span>1:still:</span>");
		expect(text(polled, "b")).toBe("<span>2:still:</span>");

		const first = polled.refresh("a");
		const firstRead = pending.get("/polled/a");
		const second = polled.refresh("a");
		expect(firstRead?.signal.aborted).toBe(true);
		pending.get("/polled/a")?.finish(3);
		await Promise.all([first, second]);
		expect(text(polled, "a")).toBe("<span>3:still:</span>");
	});

	test("callers that poll one scope share one timer and one read per tick, which stops with the last of them", () => {
		jest.useFakeTimers();
		try {
			const polled = store();
			const requested: string[] = [];
			fetchWith(async url => {
				requested.push(url);
				return new Response(JSON.stringify({ n: 1 }), { status: 200 });
			});
			const stopFirst = polled.poll("a");
			const stopSecond = polled.poll("a");
			const stopOther = polled.poll("b");
			expect(requested).toEqual(["/polled/a", "/polled/b"]);
			jest.advanceTimersByTime(60_000);
			expect(requested).toEqual(["/polled/a", "/polled/b", "/polled/a", "/polled/b"]);
			stopFirst();
			jest.advanceTimersByTime(60_000);
			expect(requested.length).toBe(6);
			stopSecond();
			stopOther();
			jest.advanceTimersByTime(120_000);
			expect(requested.length).toBe(6);
			polled.poll("a")();
			expect(requested.length).toBe(7);
		} finally {
			jest.useRealTimers();
		}
	});

	test("a hidden page reads nothing on its ticks, and reads each skipped scope once when it shows again", () => {
		jest.useFakeTimers();
		try {
			const polled = store();
			const requested: string[] = [];
			globalThis.fetch = (async (url: string) => {
				requested.push(url);
				return new Response(JSON.stringify({ n: 1 }), { status: 200 });
			}) as unknown as typeof fetch;
			const stop = polled.poll("a");
			expect(requested).toEqual(["/polled/a"]);
			page.hidden = true;
			jest.advanceTimersByTime(180_000);
			expect(requested).toEqual(["/polled/a"]);
			page.hidden = false;
			page.dispatchEvent(new Event("visibilitychange"));
			page.dispatchEvent(new Event("visibilitychange"));
			expect(requested).toEqual(["/polled/a", "/polled/a"]);
			jest.advanceTimersByTime(60_000);
			expect(requested.length).toBe(3);
			stop();
			page.hidden = true;
			jest.advanceTimersByTime(60_000);
			page.hidden = false;
			page.dispatchEvent(new Event("visibilitychange"));
			expect(requested.length).toBe(3);
		} finally {
			jest.useRealTimers();
		}
	});

	test("ensure reads once and again only after the kept answer changes or the in-flight one settles", async () => {
		const polled = store();
		const pending = new Map<string, { finish: (n: number) => void }>();
		fetchWith(url => {
			const { promise, resolve } = Promise.withResolvers<Response>();
			pending.set(url, { finish: n => resolve(new Response(JSON.stringify({ n }), { status: 200 })) });
			return promise;
		});
		polled.ensure("a");
		polled.ensure("a");
		expect(pending.size).toBe(1);
		pending.get("/polled/a")?.finish(1);
		await Promise.resolve();
		polled.ensure("a");
		polled.ensure("a");
		expect(pending.size).toBe(1);
	});

	test("ensure without persistence or validators leaves localStorage untouched", async () => {
		const polled = createPolledStore<{ n: number }>({ url: () => "/polled" });
		let calls = 0;
		fetchWith(async () => {
			calls += 1;
			return new Response(JSON.stringify({ n: 1 }));
		});
		await polled.refresh();
		expect(memory.size).toBe(0);
		expect(calls).toBe(1);
	});

	test("localStorage keeps only reads whose data has the store's shape", () => {
		const cacheKey = `test.polled.${keys.length}`;
		keys.push(cacheKey);
		localStorage.setItem(
			cacheKey,
			JSON.stringify({
				ok: { data: { n: 4 }, at: 5 },
				bad: { data: { n: "nope" }, at: 5 },
				broken: { at: 5 },
			}),
		);
		const polled = createPolledStore<{ n: number }>({
			url: () => "/polled",
			cache: { key: cacheKey, decode: decodeN },
		});
		expect(text(polled, "ok")).toBe("<span>4:still:</span>");
		expect(text(polled, "bad")).toBe("<span>-:still:</span>");
		localStorage.setItem(cacheKey, "{");
		const again = createPolledStore<{ n: number }>({
			url: () => "/polled",
			cache: { key: cacheKey, decode: decodeN },
		});
		expect(text(again, "ok")).toBe("<span>-:still:</span>");
	});
});
