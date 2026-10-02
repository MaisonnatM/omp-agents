/** The page itself: built once at startup, served only to a browser that holds the access token. */
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";
import { fetchSiteAllowed, loginCookie } from "./auth";
import type { Guards } from "./http";

/**
 * The web app bundled in memory, by URL path (`/index.html`, `/chunk-<hash>.js`, ...). Bun's HTML import would
 * serve `/` to anyone, so the server bundles the page itself and decides who gets it.
 */
export async function buildPage(): Promise<Map<string, Blob>> {
	const build = await Bun.build({
		entrypoints: [join(import.meta.dir, "..", "..", "web", "index.html")],
		plugins: [tailwind],
		minify: true,
		define: { "process.env.NODE_ENV": '"production"' },
	});
	if (!build.success) throw new AggregateError(build.logs, "cannot build the page");
	return new Map(build.outputs.map(artifact => [artifact.path.replace(/^\./, ""), artifact]));
}

const NO_STORE = { "cache-control": "no-store" };

const html = (status: number, body: string): Response =>
	new Response(`<!doctype html><meta charset="utf-8"><title>omp agents</title>${body}`, { status, headers: { "content-type": "text/html;charset=utf-8", ...NO_STORE } });

/**
 * A link on another site (a pull request's session link) arrives without the `Strict` cookie. This page, being
 * the dashboard's own, sends the browser on to `/` as a same-origin navigation that carries the cookie, and keeps
 * the `#session/<id>` hash. The empty `?` makes it a real navigation: `/` with a new hash alone would not reload.
 */
const BOUNCE = '<script>location.replace("/?" + location.hash)</script>';

const SIGN_IN = `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>Not signed in</h1>
<p>Open the address that the omp-agents server printed in its terminal when it started. It ends in <code>/?token=…</code>, and signs this browser in.</p>`;

/**
 * The answer to a request that is not for the API or the socket. `/` needs the login cookie; the printed URL's
 * `?token=` sets it and redirects to `/`, which keeps the hash. Assets need the cookie as well.
 */
export function servePage(req: Request, guards: Guards, token: string, page: ReadonlyMap<string, Blob>): Response {
	const { pathname } = new URL(req.url);
	if (pathname !== "/") {
		const refused = guards.admit(req);
		const asset = page.get(pathname);
		return refused ?? (asset ? new Response(asset) : new Response("not found", { status: 404 }));
	}
	if (!guards.allowedHost(req)) return new Response("forbidden host", { status: 403 });
	const site = req.headers.get("sec-fetch-site");
	const navigation = req.headers.get("sec-fetch-mode") === "navigate" && req.headers.get("sec-fetch-dest") === "document";
	if (site === "cross-site" && navigation) return html(200, BOUNCE);
	if (!fetchSiteAllowed(site, true)) return new Response("forbidden origin", { status: 403 });
	switch (guards.credential(req)) {
		case "login":
			return new Response(null, { status: 302, headers: { location: "/", "set-cookie": loginCookie(token), ...NO_STORE } });
		case "cookie":
			return new Response(page.get("/index.html"), { headers: { "content-type": "text/html;charset=utf-8", ...NO_STORE } });
		case null:
			return html(401, SIGN_IN);
	}
}
