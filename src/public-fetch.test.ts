import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as dns from "node:dns/promises";
import { dailyCache, readPublicHead, readPublicImage } from "./public-fetch";

const DAY_MS = 24 * 60 * 60_000;
let now = Date.now();
beforeEach(() => {
	now += 2 * DAY_MS;
	spyOn(Date, "now").mockImplementation(() => now);
	// Every name is public but `intranet.example.com`, which answers a private address.
	spyOn(dns, "lookup").mockImplementation((async (host: string) => [{ address: host === "intranet.example.com" ? "10.0.0.5" : "93.184.216.34", family: 4 }]) as unknown as typeof dns.lookup);
});
afterEach(() => mock.restore());

/** A response streamed in `chunks`, so a read sees more than one. */
function streamed(chunks: Uint8Array[], headers: Record<string, string>): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
	return new Response(body, { headers });
}

describe("dailyCache", () => {
	test("shares one load between concurrent asks for a key", async () => {
		const load = mock(async (key: string) => `${key}!`);
		const read = dailyCache(load);
		expect(await Promise.all([read("a"), read("a"), read("b")])).toEqual(["a!", "a!", "b!"]);
		expect(load).toHaveBeenCalledTimes(2);
	});

	test("keeps a miss and a failure as null for the day", async () => {
		const load = mock(async (key: string) => {
			if (key === "fails") throw new Error("down");
			return null;
		});
		const read = dailyCache(load);
		for (let ask = 0; ask < 2; ask++) {
			expect(await read("misses")).toBeNull();
			expect(await read("fails")).toBeNull();
		}
		expect(load).toHaveBeenCalledTimes(2);
	});

	test("asks again after a day", async () => {
		const load = mock(async () => "icon");
		const read = dailyCache(load);
		await read("a");
		now += DAY_MS - 1;
		await read("a");
		expect(load).toHaveBeenCalledTimes(1);
		now += 1;
		await read("a");
		expect(load).toHaveBeenCalledTimes(2);
	});

	test("drops the oldest key past 256", async () => {
		const load = mock(async (key: string) => key);
		const read = dailyCache(load);
		for (let key = 0; key <= 256; key++) await read(String(key));
		await read("256");
		expect(load).toHaveBeenCalledTimes(257);
		await read("0");
		expect(load).toHaveBeenCalledTimes(258);
	});
});

describe("readPublicHead", () => {
	test("asks for HTML and keeps the first 512 KiB", async () => {
		const part = new Uint8Array(200 * 1024).fill(0x61);
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(streamed([part, part, part], { "content-type": "text/html" }));
		const page = await readPublicHead(new URL("https://example.com/"), AbortSignal.timeout(1000));
		expect(page?.html).toBe("a".repeat(512 * 1024));
		expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Accept: "text/html" });
	});

	test("decodes with the charset the response names, else UTF-8", async () => {
		const fetcher = spyOn(globalThis, "fetch");
		const read = async (contentType: string, bytes: number[]) => {
			fetcher.mockResolvedValueOnce(streamed([new Uint8Array(bytes)], { "content-type": contentType }));
			return (await readPublicHead(new URL("https://example.com/"), AbortSignal.timeout(1000)))?.html;
		};
		expect(await read("text/html; charset=windows-1252", [0x63, 0x61, 0x66, 0xe9])).toBe("café");
		expect(await read('text/html; charset="ISO-8859-1"', [0xe9])).toBe("é");
		expect(await read("text/html", [0x63, 0x61, 0x66, 0xc3, 0xa9])).toBe("café");
		expect(await read("text/html; charset=x-unknown", [0xc3, 0xa9])).toBe("é");
	});

	test("follows a redirect to a public host and answers its address", async () => {
		spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.example.com/home" } }))
			.mockResolvedValueOnce(new Response("<title>Home</title>", { headers: { "content-type": "text/html; charset=utf-8" } }));
		const page = await readPublicHead(new URL("https://example.com/"), AbortSignal.timeout(1000));
		expect(page).toEqual({ url: new URL("https://www.example.com/home"), html: "<title>Home</title>" });
		expect(dns.lookup).toHaveBeenCalledWith("www.example.com", { all: true });
	});

	test("refuses a redirect to a host with a private address, or off HTTPS, without asking it", async () => {
		const fetcher = spyOn(globalThis, "fetch");
		for (const location of ["https://intranet.example.com/", "http://www.example.com/", "https://www.example.com:8443/"]) {
			fetcher.mockClear();
			fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
			expect(await readPublicHead(new URL("https://example.com/"), AbortSignal.timeout(1000))).toBeNull();
			expect(fetcher).toHaveBeenCalledTimes(1);
		}
	});

	test("refuses anything but an HTML page", async () => {
		spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
		expect(await readPublicHead(new URL("https://example.com/"), AbortSignal.timeout(1000))).toBeNull();
	});
});

describe("readPublicImage", () => {
	test("asks for an image and refuses one over 256 KiB", async () => {
		const part = new Uint8Array(200 * 1024);
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(streamed([part, part], { "content-type": "image/png" }));
		expect(await readPublicImage(new URL("https://example.com/favicon.ico"), AbortSignal.timeout(1000))).toBeNull();
		expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Accept: "image/*" });
	});

	test("answers an image under the cap with its type", async () => {
		spyOn(globalThis, "fetch").mockResolvedValue(new Response("png", { headers: { "content-type": "image/png" } }));
		const icon = await readPublicImage(new URL("https://example.com/favicon.ico"), AbortSignal.timeout(1000));
		expect(icon?.type).toBe("image/png");
		expect(await icon?.text()).toBe("png");
	});
});
