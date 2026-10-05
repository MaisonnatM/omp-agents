import { afterEach, describe, expect, test } from "bun:test";
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
