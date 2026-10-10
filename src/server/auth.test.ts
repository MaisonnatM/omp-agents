import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COOKIE, cookieValue, fetchSiteAllowed, loadToken, loginCookie, tokenMatches } from "./auth";
import { guardsFor } from "./http";
import { servePage } from "./page";

const TOKEN = "A".repeat(43);
const page = new Map([["/index.html", new Blob(["<p>app</p>"])]]);
const guards = guardsFor(4317, TOKEN);
const request = (path: string, headers: Record<string, string> = {}): Request =>
	new Request(`http://127.0.0.1:4317${path}`, { headers: { host: "127.0.0.1:4317", ...headers } });
const signedIn = { cookie: `other=1; ${COOKIE}=${TOKEN}` };

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

	test("a file others could read is tightened, and one that is not a token is replaced", () => {
		const token = loadToken(file);
		chmodSync(file, 0o644);
		expect(loadToken(file)).toBe(token);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		writeFileSync(file, "short\n");
		const replaced = loadToken(file);
		expect(replaced).not.toBe(token);
		expect(replaced).toMatch(/^[A-Za-z0-9_-]{43}$/);
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

describe("cookieValue", () => {
	test("finds a cookie among others, and not by suffix", () => {
		expect(cookieValue(`a=1; ${COOKIE}=abc; b=2`, COOKIE)).toBe("abc");
		expect(cookieValue(`x${COOKIE}=abc`, COOKIE)).toBeNull();
		expect(cookieValue("a=1", COOKIE)).toBeNull();
		expect(cookieValue(null, COOKIE)).toBeNull();
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

describe("API and socket guards", () => {
	test("without the cookie the request is 401, with it admitted", () => {
		expect(guards.admit(request("/api/settings"))?.status).toBe(401);
		expect(guards.admit(request("/api/settings", { cookie: `${COOKIE}=wrong` }))?.status).toBe(401);
		expect(guards.admit(request(`/api/settings?token=${TOKEN}`))?.status).toBe(401);
		expect(guards.admit(request("/api/settings", signedIn))).toBeNull();
		// A stray `?token=` beside the cookie, as the desktop shell's probe carries, is no reason to refuse.
		expect(guards.admit(request(`/api/settings?token=${TOKEN}`, signedIn))).toBeNull();
	});

	test("a cross-site GET is refused even with the cookie, and a foreign Host first", () => {
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, "sec-fetch-site": "cross-site" }))?.status).toBe(403);
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, "sec-fetch-site": "same-site" }))?.status).toBe(403);
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, "sec-fetch-site": "same-origin" }))).toBeNull();
		expect(guards.admit(request("/api/pull-requests", { ...signedIn, host: "evil.test:4317" }))?.status).toBe(403);
	});

	test("the socket also needs an Origin that matches the Host", () => {
		expect(guards.admitSocket(request("/ws", signedIn))?.status).toBe(403);
		expect(guards.admitSocket(request("/ws", { ...signedIn, origin: "http://evil.test" }))?.status).toBe(403);
		expect(guards.admitSocket(request("/ws", { origin: "http://127.0.0.1:4317" }))?.status).toBe(401);
		expect(guards.admitSocket(request("/ws", { ...signedIn, origin: "http://127.0.0.1:4317" }))).toBeNull();
	});

	test("a write without the cookie is 401 before its body is read", async () => {
		const write = request("/api/settings/routing", { origin: "http://127.0.0.1:4317", "content-type": "application/json" });
		const refused = await guards.writeBody(new Request(write, { method: "PUT", body: "{}" }));
		expect(refused).toBeInstanceOf(Response);
		expect((refused as Response).status).toBe(401);
	});
});

describe("the page", () => {
	const serve = (path: string, headers?: Record<string, string>): Response => servePage(request(path, headers), guards, TOKEN, page);

	test("without a credential `/` is a 401 page that names no token", async () => {
		const response = serve("/");
		expect(response.status).toBe(401);
		expect(await response.text()).not.toContain(TOKEN);
		expect(serve(`/?token=${"B".repeat(43)}`).status).toBe(401);
		expect(serve("/chunk.js").status).toBe(401);
	});

	test("the printed URL sets an HttpOnly Strict cookie and redirects to `/`", () => {
		const response = serve(`/?token=${TOKEN}`, { "sec-fetch-site": "none" });
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/");
		expect(response.headers.get("set-cookie")).toBe(loginCookie(TOKEN));
		expect(loginCookie(TOKEN)).toMatch(/; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d{7,}$/);
		// A browser already signed in still gets the redirect, so the token leaves its address bar and history.
		expect(serve(`/?token=${TOKEN}`, { ...signedIn, "sec-fetch-site": "none" }).status).toBe(302);
	});

	test("with the cookie `/` serves the app, and assets come from the build", async () => {
		const response = serve("/", { ...signedIn, "sec-fetch-site": "same-origin" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<p>app</p>");
		expect(serve("/index.html", signedIn).status).toBe(200);
		expect(serve("/missing.js", signedIn).status).toBe(404);
	});

	test("a cross-site request never logs in, but a link click bounces to `/` with its hash", async () => {
		expect(serve(`/?token=${TOKEN}`, { "sec-fetch-site": "cross-site" }).status).toBe(403);
		expect(serve("/", { ...signedIn, "sec-fetch-site": "cross-site" }).status).toBe(403);
		const click = serve("/", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
		expect(click.status).toBe(200);
		expect(click.headers.get("set-cookie")).toBeNull();
		expect(await click.text()).not.toContain("app");
	});
});
