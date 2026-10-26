/** The page itself: built once at startup, or read prebuilt in a packaged app. */
import { join } from "node:path";
import { fetchSiteAllowed } from "./auth";
import type { Guards } from "./http";
import { prebuiltPageDir } from "./resources";

/** The web app by URL path (`/index.html`, `/chunk-<hash>.js`, ...). */
export type Page = ReadonlyMap<string, Blob>;

/**
 * Bundles `web/index.html` in memory. Bun's HTML import would serve `/` to anyone, so the server bundles the page
 * itself and decides who gets it.
 */
export async function buildPage(): Promise<Map<string, Blob>> {
	// Dynamic so the packaged server, which reads a prebuilt page, neither bundles nor ships Tailwind and its native binary.
	const { default: tailwind } = await import("bun-plugin-tailwind");
	const build = await Bun.build({
		entrypoints: [join(import.meta.dir, "..", "..", "web", "index.html")],
		plugins: [tailwind],
		minify: true,
		// A dynamic import becomes its own chunk, so the diagram renderer loads only when a session draws one.
		splitting: true,
		define: { "process.env.NODE_ENV": '"production"' },
	});
	if (!build.success) throw new AggregateError(build.logs, "cannot build the page");
	return new Map(build.outputs.map(artifact => [artifact.path.replace(/^\./, ""), artifact]));
}

/** The files `scripts/build-desktop-artifact.ts` wrote into `dir`, by URL path. */
function readPage(dir: string): Map<string, Blob> {
	const files = [...new Bun.Glob("**/*").scanSync({ cwd: dir })];
	if (!files.includes("index.html")) throw new Error(`${dir} holds no prebuilt page`);
	return new Map(files.map(file => [`/${file}`, Bun.file(join(dir, file))]));
}

/** The page this server serves: the packaged app's prebuilt one, else a fresh build of the checkout's. */
export const loadPage = async (): Promise<Page> => (prebuiltPageDir ? readPage(prebuiltPageDir) : buildPage());

/** What names `page`'s build: its `index.html` names every chunk by the hash of its content. */
export const pageBuild = async (page: Page): Promise<string> => Bun.hash(await (page.get("/index.html")?.text() ?? "")).toString(36);

const NO_STORE = { "cache-control": "no-store" };
/** Bun names every file of the build but `index.html` by the hash of its content, so a browser keeps one until a build renames it. */
const IMMUTABLE = { "cache-control": "private, max-age=31536000, immutable" };

/** Removes the cookie that older servers signed browsers in with: every port of the host was sent it, so it must not linger. */
const FORGET_COOKIE = { "set-cookie": "omp-agents-token=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict" };

/**
 * The answer to a request that is not for the API or the socket. The page's code is no secret: what it reads, it
 * reads through the API with the token that the desktop window's preload keeps in localStorage, so `/` and its assets
 * need no token, and a query on `/` changes nothing. `/` is also any link's landing, such as a pull request's session
 * link from another site.
 */
export function servePage(req: Request, guards: Guards, page: ReadonlyMap<string, Blob>): Response {
	const url = new URL(req.url);
	if (!guards.allowedHost(req)) return new Response("forbidden host", { status: 403 });
	const site = req.headers.get("sec-fetch-site");
	if (url.pathname !== "/") {
		const asset = page.get(url.pathname);
		if (!fetchSiteAllowed(site, false)) return new Response("forbidden origin", { status: 403 });
		if (!asset) return new Response("not found", { status: 404 });
		return new Response(asset, { headers: url.pathname === "/index.html" ? NO_STORE : IMMUTABLE });
	}
	const navigation = req.headers.get("sec-fetch-mode") === "navigate" && req.headers.get("sec-fetch-dest") === "document";
	if (!navigation && !fetchSiteAllowed(site, true)) return new Response("forbidden origin", { status: 403 });
	return new Response(page.get("/index.html"), { headers: { "content-type": "text/html;charset=utf-8", ...NO_STORE, ...FORGET_COOKIE } });
}
