import { afterEach, describe, expect, jest, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createPolledStore, type PolledEntry } from "./polled-store";

const memory = new Map<string, string>();
globalThis.localStorage = {
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
} as Storage;

const keys: string[] = [];

function store() {
	const cacheKey = `test.polled.${keys.length}`;
	keys.push(cacheKey);
	return createPolledStore<{ n: number }>({
		cacheKey,
		url: scope => `/polled/${scope ?? ""}`,
		isValid: (value): value is { n: number } => typeof (value as { n?: unknown } | null)?.n === "number",
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

afterEach(() => {
	for (const key of keys) localStorage.removeItem(key);
	keys.length = 0;
});

describe("polled store", () => {
	test("a read that a newer one superseded does not replace the newer answer", async () => {
		const polled = store();
		let finishFirst: (response: Response) => void = () => {};
		const first = new Promise<Response>(resolve => {
			finishFirst = resolve;
		});
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			if (calls === 1) return first;
			return new Response(JSON.stringify({ n: 2 }), { status: 200 });
		}) as unknown as typeof fetch;
		const older = polled.refresh("a");
		const newer = polled.refresh("a");
		finishFirst(new Response(JSON.stringify({ n: 1 }), { status: 200 }));
		await older;
		await newer;
		expect(text(polled, "a")).toBe("<span>2:still:</span>");
	});

	test("reads of two scopes in flight at once both complete, and each refresh aborts only a read of its own scope", async () => {
		const polled = store();
		const pending = new Map<string, { signal: AbortSignal; finish: (n: number) => void }>();
		globalThis.fetch = ((url: string, { signal }: { signal: AbortSignal }) =>
			new Promise<Response>((resolve, reject) => {
				signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				pending.set(url, { signal, finish: n => resolve(new Response(JSON.stringify({ n }), { status: 200 })) });
			})) as unknown as typeof fetch;
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
			globalThis.fetch = (async (url: string) => {
				requested.push(url);
				return new Response(JSON.stringify({ n: 1 }), { status: 200 });
			}) as unknown as typeof fetch;
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
			cacheKey,
			url: () => "/polled",
			isValid: (value): value is { n: number } => typeof (value as { n?: unknown } | null)?.n === "number",
		});
		expect(text(polled, "ok")).toBe("<span>4:still:</span>");
		expect(text(polled, "bad")).toBe("<span>-:still:</span>");
		localStorage.setItem(cacheKey, "{");
		const again = createPolledStore<{ n: number }>({
			cacheKey,
			url: () => "/polled",
			isValid: (value): value is { n: number } => typeof (value as { n?: unknown } | null)?.n === "number",
		});
		expect(text(again, "ok")).toBe("<span>-:still:</span>");
	});
});
