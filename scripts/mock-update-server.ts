/**
 * Serves `desktop/release` as the update feed of an app built with `--mock-update-port`, as T3 Code's mock update
 * server does, so an update can be tried end to end without publishing a release:
 *
 *   bun scripts/build-desktop-artifact.ts --mock-update-port <port>   # the older app; install it
 *   (bump desktop/package.json's version, rebuild the same way)
 *   bun scripts/mock-update-server.ts <port>
 */
import { join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "..", "desktop", "release");
const port = Number(Bun.argv[2]);
if (!Number.isInteger(port) || port <= 0) throw new Error("usage: bun scripts/mock-update-server.ts <port>");

Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(req) {
		const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^\/+/, "");
		const file = Bun.file(join(ROOT, path));
		if (path.startsWith("..") || path.includes("/") || !(await file.exists())) return new Response("not found", { status: 404 });
		console.log(`${req.method} /${path}`);
		return new Response(file);
	},
});
console.log(`Serving ${ROOT} on http://127.0.0.1:${port}`);
