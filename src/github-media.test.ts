import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readGithubMedia } from "./github-media";
import * as proc from "./proc";
import { githubMediaPath } from "./shared/github";

let now = Date.now();
beforeEach(() => {
	now += 600_000;
	spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => mock.restore());

const image = () => new Response("png", { headers: { "content-type": "image/png", "set-cookie": "upstream=secret" } });

describe("GitHub media", () => {
	test("routes only the allowed HTTPS hosts through this server, without the fragment", () => {
		expect(githubMediaPath("https://github.com/user-attachments/assets/abc")).toBe("/api/github-media?url=https%3A%2F%2Fgithub.com%2Fuser-attachments%2Fassets%2Fabc");
		expect(githubMediaPath("https://private-user-images.githubusercontent.com/1/image.png?jwt=a&x=2")).toBe("/api/github-media?url=https%3A%2F%2Fprivate-user-images.githubusercontent.com%2F1%2Fimage.png%3Fjwt%3Da%26x%3D2");
		expect(githubMediaPath("//user-images.githubusercontent.com/1/demo.mp4")).toBe("/api/github-media?url=https%3A%2F%2Fuser-images.githubusercontent.com%2F1%2Fdemo.mp4");
		expect(githubMediaPath("https://github.com/user-attachments/assets/abc#top")).toBe("/api/github-media?url=https%3A%2F%2Fgithub.com%2Fuser-attachments%2Fassets%2Fabc");
		expect(githubMediaPath("https://camo.githubusercontent.com/a/image")).toBe("/api/github-media?url=https%3A%2F%2Fcamo.githubusercontent.com%2Fa%2Fimage");
		for (const url of ["javascript:alert(1)", "http://github.com/user-attachments/assets/abc", "https://github.com.evil.test/user-attachments/assets/abc", "https://private-user-images.githubusercontent.com.evil.test/a.png", "https://github.com/acme/app", "https://github.com/user-attachments-other/a", "https://raw.githubusercontent.com/acme/app/main/a.png", "https://user:secret@github.com/user-attachments/assets/a", "https://github.com:444/user-attachments/assets/a"]) expect(githubMediaPath(url)).toBeNull();
	});

	test.each([
		"https://private-user-images.githubusercontent.com/1/image.png?jwt=signed",
		"https://user-images.githubusercontent.com/1/image.png",
		"https://camo.githubusercontent.com/digest/image.png",
	])("fetches an allowed CDN without reading or sending a credential: %s", async url => {
		const token = spyOn(proc, "runChecked").mockResolvedValue("github-secret\n");
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(image());
		const response = await readGithubMedia(url);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("png");
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe("private, max-age=300");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(token).not.toHaveBeenCalled();
		expect(fetcher.mock.calls[0]?.[0]).toBe(url);
		const options = fetcher.mock.calls[0]?.[1];
		expect(options?.redirect).toBe("manual");
		expect(new Headers(options?.headers).get("authorization")).toBeNull();
		expect(new Headers(options?.headers).get("cookie")).toBeNull();
	});

	test("reads a GitHub-only token and drops it on the signed CDN redirect", async () => {
		const token = spyOn(proc, "runChecked").mockResolvedValue("github-secret\n");
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, {
			status: 302,
			headers: { location: "https://private-user-images.githubusercontent.com/7/shot.png?jwt=signature" },
		})).mockResolvedValueOnce(image());
		const response = await readGithubMedia("https://github.com/user-attachments/assets/shot");
		expect(response.status).toBe(200);
		expect(token.mock.calls[0]?.[0]).toEqual(["gh", "auth", "token", "--hostname", "github.com"]);
		expect(token.mock.calls[0]?.[1]?.timeoutMs).toBe(15_000);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"https://github.com/user-attachments/assets/shot",
			"https://private-user-images.githubusercontent.com/7/shot.png?jwt=signature",
		]);
		expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get("authorization"))).toEqual(["Bearer github-secret", null]);
		expect(fetcher.mock.calls.map(([, options]) => options?.redirect)).toEqual(["manual", "manual"]);
		expect(token.mock.calls[0]?.[1]?.signal).toBe(fetcher.mock.calls[0]?.[1]?.signal ?? undefined);
		expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(fetcher.mock.calls[0]?.[1]?.signal);
	});

	test("keeps the token for relative GitHub redirects and never sends it to camo", async () => {
		const token = spyOn(proc, "runChecked").mockResolvedValue("github-secret");
		const fetcher = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/user-attachments/assets/next" } }))
			.mockResolvedValueOnce(new Response(null, { status: 308, headers: { location: "https://camo.githubusercontent.com/next" } }))
			.mockResolvedValueOnce(new Response("video", { headers: { "content-type": "video/mp4; codecs=avc1" } }));
		const response = await readGithubMedia("https://github.com/user-attachments/assets/relative");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("video/mp4");
		expect(await response.text()).toBe("video");
		expect(token).toHaveBeenCalledTimes(1);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"https://github.com/user-attachments/assets/relative",
			"https://github.com/user-attachments/assets/next",
			"https://camo.githubusercontent.com/next",
		]);
		expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get("authorization"))).toEqual(["Bearer github-secret", "Bearer github-secret", null]);
	});

	test("reads the token once a minute across fetches", async () => {
		const token = spyOn(proc, "runChecked").mockResolvedValue("github-secret");
		spyOn(globalThis, "fetch").mockResolvedValueOnce(image()).mockResolvedValueOnce(image()).mockResolvedValueOnce(image());
		await readGithubMedia("https://github.com/user-attachments/assets/first");
		now += 59_999;
		await readGithubMedia("https://github.com/user-attachments/assets/second");
		expect(token).toHaveBeenCalledTimes(1);
		now += 1;
		await readGithubMedia("https://github.com/user-attachments/assets/third");
		expect(token).toHaveBeenCalledTimes(2);
	});

	test("follows github.com's signed redirect into its upload bucket without the token", async () => {
		spyOn(proc, "runChecked").mockResolvedValue("github-secret");
		const fetcher = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://github-production-user-asset-6210df.s3.amazonaws.com/27284940/shot.png?X-Amz-Signature=abc" } }))
			.mockResolvedValueOnce(image());
		expect((await readGithubMedia("https://github.com/user-attachments/assets/bucket")).status).toBe(200);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"https://github.com/user-attachments/assets/bucket",
			"https://github-production-user-asset-6210df.s3.amazonaws.com/27284940/shot.png?X-Amz-Signature=abc",
		]);
		expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get("authorization"))).toEqual(["Bearer github-secret", null]);
	});

	test("refuses the upload bucket from anywhere but github.com", async () => {
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://github-production-user-asset-6210df.s3.amazonaws.com/1/a.png" } }));
		const response = await readGithubMedia("https://camo.githubusercontent.com/digest/a.png");
		expect(response.status).toBe(502);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("adds a token only when a CDN redirects back to an allowed GitHub attachment", async () => {
		spyOn(proc, "runChecked").mockResolvedValue("github-secret");
		const fetcher = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: "https://github.com/user-attachments/assets/from-cdn" } }))
			.mockResolvedValueOnce(image());
		expect((await readGithubMedia("https://user-images.githubusercontent.com/redirect-back")).status).toBe(200);
		expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get("authorization"))).toEqual([null, "Bearer github-secret"]);
	});

	test.each([
		null,
		"not a url",
		"http://github.com/user-attachments/assets/a",
		"https://github.com/acme/repo/assets/a",
		"https://github.com/user-attachments/../login",
		"https://api.github.com/user-attachments/assets/a",
		"https://raw.githubusercontent.com/acme/repo/main/a.png",
		"https://media.githubusercontent.com/a.png",
		"https://github.com.evil.test/user-attachments/assets/a",
		"https://private-user-images.githubusercontent.com.evil.test/a",
		"https://evil.test/a.png",
		"https://127.0.0.1/a.png",
		"https://constructor/a.png",
		"https://user:pass@github.com/user-attachments/assets/a",
		"https://user-images.githubusercontent.com:444/a.png",
	])("rejects a URL outside the exact HTTPS allowlist without fetching: %s", async url => {
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(image());
		const token = spyOn(proc, "runChecked").mockResolvedValue("secret");
		const response = await readGithubMedia(url);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Expected an HTTPS GitHub media URL" });
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(fetcher).not.toHaveBeenCalled();
		expect(token).not.toHaveBeenCalled();
	});

	test.each([
		"https://evil.test/leak",
		"http://github-production-user-asset-6210df.s3.amazonaws.com/27284940/image.png",
		"https://github-production-user-asset-6210df.s3.amazonaws.com:444/27284940/image.png",
		"http://user-images.githubusercontent.com/insecure",
		"https://github.com/login",
		"https://api.github.com/user-attachments/assets/a",
		"https://user-images.githubusercontent.com:444/a",
		"https://user:pass@github.com/user-attachments/assets/a",
	])("rejects a redirect target before it can receive a request: %s", async location => {
		spyOn(proc, "runChecked").mockResolvedValue("secret");
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
		const response = await readGithubMedia("https://github.com/user-attachments/assets/rejected-redirect");
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: "GitHub media redirected outside the allowed hosts" });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("stops redirect loops after five hops", async () => {
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response(null, { status: 301, headers: { location: "/loop" } }), { preconnect: fetch.preconnect }));
		expect((await readGithubMedia("https://user-images.githubusercontent.com/loop")).status).toBe(502);
		expect(fetcher).toHaveBeenCalledTimes(6);
	});

	test.each(["text/html", "application/octet-stream", "application/json", ""])("rejects a non-media MIME type: %s", async type => {
		spyOn(globalThis, "fetch").mockResolvedValue(new Response("not media", { headers: { "content-type": type } }));
		const response = await readGithubMedia("https://user-images.githubusercontent.com/not-media");
		expect(response.status).toBe(415);
		expect(await response.json()).toEqual({ error: "GitHub media must be an image or video" });
	});

	test("cancels an advertised oversized response without reading its body", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
		spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers: { "content-type": "image/png", "content-length": "20971521" } }));
		const response = await readGithubMedia("https://user-images.githubusercontent.com/advertised-large");
		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
	});

	test("caps streamed bytes even with a smaller content-length", async () => {
		let cancelled = false;
		const chunk = new Uint8Array(1024 * 1024);
		const body = new ReadableStream<Uint8Array>({
			pull(controller) { controller.enqueue(chunk); },
			cancel() { cancelled = true; },
		});
		spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers: { "content-type": "video/mp4", "content-length": "1" } }));
		const response = await readGithubMedia("https://user-images.githubusercontent.com/streamed-large");
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: "GitHub media exceeds 20 MiB" });
		expect(cancelled).toBe(true);
	});

	test("does not cache a failed fetch and hides upstream error details", async () => {
		const fetcher = spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("private signed URL and token")).mockResolvedValueOnce(image());
		const first = await readGithubMedia("https://user-images.githubusercontent.com/retry");
		expect(first.status).toBe(502);
		expect(await first.json()).toEqual({ error: "GitHub media could not be loaded" });
		expect((await readGithubMedia("https://user-images.githubusercontent.com/retry")).status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	test("times out a stalled body with the same deadline as its fetch", async () => {
		const controller = new AbortController();
		const deadline = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
		spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (_url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => new Response(new ReadableStream({
			start(stream) {
				options?.signal?.addEventListener("abort", () => stream.error(new Error("aborted")), { once: true });
				queueMicrotask(() => controller.abort());
			},
		}), { headers: { "content-type": "image/png" } }), { preconnect: fetch.preconnect }));
		const response = await readGithubMedia("https://user-images.githubusercontent.com/stalled");
		expect(response.status).toBe(502);
		expect(deadline).toHaveBeenCalledWith(15_000);
	});

	test("reuses media for five minutes and then fetches it again", async () => {
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => image(), { preconnect: fetch.preconnect }));
		expect(await (await readGithubMedia("https://user-images.githubusercontent.com/cached")).text()).toBe("png");
		now += 299_999;
		expect(await (await readGithubMedia("https://user-images.githubusercontent.com/cached")).text()).toBe("png");
		expect(fetcher).toHaveBeenCalledTimes(1);
		now++;
		expect((await readGithubMedia("https://user-images.githubusercontent.com/cached")).status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	test("bounds the cache to 32 entries", async () => {
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => image(), { preconnect: fetch.preconnect }));
		for (let i = 0; i < 33; i++) expect((await readGithubMedia(`https://user-images.githubusercontent.com/cache-entry-${i}`)).status).toBe(200);
		expect((await readGithubMedia("https://user-images.githubusercontent.com/cache-entry-1")).status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(33);
		expect((await readGithubMedia("https://user-images.githubusercontent.com/cache-entry-0")).status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(34);
	});

	test("bounds cached media to 40 MiB", async () => {
		const bytes = new Uint8Array(20 * 1024 * 1024);
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response(bytes, { headers: { "content-type": "video/mp4" } }), { preconnect: fetch.preconnect }));
		for (const name of ["byte-a", "byte-b", "byte-c", "byte-b"]) expect((await readGithubMedia(`https://user-images.githubusercontent.com/${name}`)).status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect((await readGithubMedia("https://user-images.githubusercontent.com/byte-a")).status).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(4);
	});
});
