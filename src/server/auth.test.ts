import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_KEY_STORAGE_KEY, TOKEN_STORAGE_KEY } from "../shared/access";
import { bearerToken, fetchSiteAllowed, helloProof, loadToken, mediaKey, pageAccess, tokenMatches } from "./auth";
import { guardsFor } from "./http";
import { servePage } from "./page";

const TOKEN = "A".repeat(43);
const page = new Map([
	["/index.html", new Blob(["<p>app</p>"])],
	["/chunk-abc123.js", new Blob(["app()"], { type: "text/javascript;charset=utf-8" })],
]);
const guards = guardsFor(4317, TOKEN);
const request = (path: string, headers: Record<string, string> = {}): Request =>
	new Request(`http://127.0.0.1:4317${path}`, { headers: { host: "127.0.0.1:4317", ...headers } });
const signedIn = { authorization: `Bearer ${TOKEN}` };
const sameOrigin = { origin: "http://127.0.0.1:4317" };

describe("the token file", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-token-"));
	const file = join(dir, "config", "token");

	test("is created readable by the user alone and survives a restart", () => {
		const token = loadToken(file);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(statSync(join(dir, "config")).mode & 0o777).toBe(0o700);
		expect(loadToken(file)).toBe(token);
	});

	test("a file others could read is replaced, as is one that is not a token", () => {
		const token = loadToken(file);
		chmodSync(file, 0o644);
		const replaced = loadToken(file);
		expect(replaced).not.toBe(token);
		expect(replaced).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		writeFileSync(file, "short\n", { mode: 0o600 });
		expect(loadToken(file)).not.toBe(replaced);
	});

	test("deleting the file rotates the token", () => {
		const token = loadToken(file);
		rmSync(file);
		expect(loadToken(file)).not.toBe(token);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("tokenMatches", () => {
	test("accepts the token only", () => {
		expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
		expect(tokenMatches(TOKEN, `${TOKEN}x`)).toBe(false);
		expect(tokenMatches(TOKEN, TOKEN.slice(1))).toBe(false);
		expect(tokenMatches(TOKEN, "")).toBe(false);
		expect(tokenMatches(TOKEN, null)).toBe(false);
	});
});

describe("Sec-Fetch-Site", () => {
	test("only same-origin passes, plus none for a page, and no header for non-browsers", () => {
		expect(fetchSiteAllowed(null, false)).toBe(true);
		expect(fetchSiteAllowed("same-origin", false)).toBe(true);
		expect(fetchSiteAllowed("same-site", false)).toBe(false);
		expect(fetchSiteAllowed("cross-site", true)).toBe(false);
		expect(fetchSiteAllowed("none", false)).toBe(false);
		expect(fetchSiteAllowed("none", true)).toBe(true);
	});
});

describe("bearerToken", () => {
	test("reads the Bearer scheme only", () => {
		expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
		expect(bearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
		expect(bearerToken(`Basic ${TOKEN}`)).toBeNull();
		expect(bearerToken(null)).toBeNull();
	});
});

describe("API and socket guards", () => {
	test("without the Bearer token the request is 401, with it admitted", () => {
		expect(guards.admit(request("/api/settings"))?.status).toBe(401);
		expect(guards.admit(request("/api/settings", { authorization: "Bearer wrong" }))?.status).toBe(401);
		expect(guards.admit(request(`/api/settings?token=${TOKEN}`))?.status).toBe(401);
		// The cookie that older servers set reached every port of the host, so it signs nothing in.
		expect(guards.admit(request("/api/settings", { cookie: `omp-agents-token=${TOKEN}` }))?.status).toBe(401);
		expect(guards.admit(request("/api/settings", signedIn))).toBeNull();
	});

	test("a cross-site GET is refused even with the token, and a foreign Host first", () => {
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, "sec-fetch-site": "cross-site" }))?.status).toBe(403);
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, "sec-fetch-site": "same-site" }))?.status).toBe(403);
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, "sec-fetch-site": "same-origin" }))).toBeNull();
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, host: "evil.test:4317" }))?.status).toBe(403);
	});

	test("the media key opens media routes only, and only from this origin", () => {
		const key = mediaKey(TOKEN);
		expect(key).not.toContain(TOKEN);
		expect(guards.admitMedia(request(`/api/media?path=a.png&key=${key}`))).toBeNull();
		expect(guards.admitMedia(request("/api/media?path=a.png", signedIn))).toBeNull();
		expect(guards.admitMedia(request("/api/media?path=a.png&key=wrong"))?.status).toBe(401);
		expect(guards.admitMedia(request(`/api/media?path=a.png&key=${TOKEN}`))?.status).toBe(401);
		expect(guards.admitMedia(request(`/api/media?path=a.png&key=${key}`, { "sec-fetch-site": "cross-site" }))?.status).toBe(403);
		expect(guards.admit(request(`/api/settings?key=${key}`))?.status).toBe(401);
	});

	test("the socket needs an Origin that matches the Host, and takes the token as a subprotocol", () => {
		const protocol = { "sec-websocket-protocol": `omp-agents, bearer.${TOKEN}` };
		expect(guards.admitSocket(request("/ws", signedIn))?.status).toBe(403);
		expect(guards.admitSocket(request("/ws", { ...protocol, origin: "http://evil.test" }))?.status).toBe(403);
		expect(guards.admitSocket(request("/ws", sameOrigin))?.status).toBe(401);
		expect(guards.admitSocket(request("/ws", { ...sameOrigin, "sec-websocket-protocol": "omp-agents, bearer.wrong" }))?.status).toBe(401);
		expect(guards.admitSocket(request("/ws", { ...sameOrigin, ...signedIn }))).toBeNull();
		expect(guards.admitSocket(request("/ws", { ...sameOrigin, ...protocol }))).toBeNull();
	});

	test("the socket's answer never echoes the offered token", () => {
		const offered = request("/ws", { "sec-websocket-protocol": `bearer.${TOKEN}, omp-agents` });
		expect(guards.socketHeaders(offered)).toEqual({ "sec-websocket-protocol": "omp-agents" });
		expect(guards.socketHeaders(request("/ws"))).toEqual({});
	});

	test("a write without the token is 401 before its body is read", async () => {
		const write = request("/api/settings/routing", { ...sameOrigin, "content-type": "application/json" });
		const refused = await guards.writeBody(new Request(write, { method: "PUT", body: "{}" }));
		expect(refused).toBeInstanceOf(Response);
		expect((refused as Response).status).toBe(401);
	});
});

describe("pageAccess", () => {
	test("names the entries the page reads, and they sign in to the API and the media routes", () => {
		const access = pageAccess(TOKEN);
		expect(access).toEqual({ [TOKEN_STORAGE_KEY]: TOKEN, [MEDIA_KEY_STORAGE_KEY]: mediaKey(TOKEN) });
		expect(guards.admit(request("/api/settings", { authorization: `Bearer ${access[TOKEN_STORAGE_KEY]}` }))).toBeNull();
		expect(guards.admitMedia(request(`/api/media?path=a.png&key=${access[MEDIA_KEY_STORAGE_KEY]}`))).toBeNull();
	});
});

describe("hello", () => {
	test("proves the token for the port and nonce without naming it", async () => {
		const nonce = "n".repeat(32);
		const response = guards.hello(request(`/api/hello?nonce=${nonce}`));
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain(TOKEN);
		expect(JSON.parse(text)).toEqual({ proof: helloProof(TOKEN, 4317, nonce) });
		// Another port's server answers for itself, so a program on this port cannot pass on its proof.
		expect(helloProof(TOKEN, 4318, nonce)).not.toBe(helloProof(TOKEN, 4317, nonce));
	});

	test("refuses a short or odd nonce, a foreign Host, and another site", () => {
		expect(guards.hello(request("/api/hello?nonce=short")).status).toBe(400);
		expect(guards.hello(request(`/api/hello?nonce=${"n".repeat(31)}%20`)).status).toBe(400);
		expect(guards.hello(request(`/api/hello?nonce=${"n".repeat(32)}`, { host: "evil.test:4317" })).status).toBe(403);
		expect(guards.hello(request(`/api/hello?nonce=${"n".repeat(32)}`, { "sec-fetch-site": "cross-site" })).status).toBe(403);
	});
});

describe("the page", () => {
	const serve = (path: string, headers?: Record<string, string>): Response => servePage(request(path, headers), guards, page);
	const forgetsCookie = (response: Response): void => expect(response.headers.get("set-cookie")).toMatch(/^omp-agents-token=; Max-Age=0;/);

	test("`/` and its assets are served without a token, and drop the old cookie", async () => {
		const response = serve("/", { "sec-fetch-site": "none" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<p>app</p>");
		forgetsCookie(response);
		expect(serve("/index.html", { "sec-fetch-site": "same-origin" }).status).toBe(200);
		expect(serve("/missing.js").status).toBe(404);
		expect(serve("/", { host: "evil.test:4317" }).status).toBe(403);
	});

	test("`/?token=` signs nothing in: it answers the page itself, which holds no token", async () => {
		const response = serve(`/?token=${TOKEN}`, { "sec-fetch-site": "none" });
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toBe("<p>app</p>");
		expect(body).not.toContain(TOKEN);
	});

	test("a browser keeps an asset, which its content names, but never `index.html`, which names the assets of the build", () => {
		const asset = serve("/chunk-abc123.js", { "sec-fetch-site": "same-origin" });
		expect(asset.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
		expect(asset.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
		expect(serve("/index.html", { "sec-fetch-site": "same-origin" }).headers.get("cache-control")).toBe("no-store");
		expect(serve("/", { "sec-fetch-site": "same-origin" }).headers.get("cache-control")).toBe("no-store");
	});

	test("another site cannot fetch the page, but a link click lands on the app", async () => {
		expect(serve("/", { "sec-fetch-site": "cross-site" }).status).toBe(403);
		expect(serve("/index.html", { "sec-fetch-site": "cross-site" }).status).toBe(403);
		const click = serve("/", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
		expect(click.status).toBe(200);
		expect(await click.text()).toBe("<p>app</p>");
	});
});
