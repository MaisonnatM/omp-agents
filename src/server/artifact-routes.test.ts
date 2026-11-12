import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_KINDS } from "../shared/artifacts";
import { artifactRoutes } from "./artifact-routes";
import { guardsFor } from "./http";
import { routeKit } from "./route-kit";

const token = "t".repeat(43);
const guards = guardsFor(4317, token);
const dir = mkdtempSync(join(tmpdir(), "omp-artifact-routes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sessions = new Map<string, string>();
const routes = artifactRoutes(routeKit(guards), { sessionFileOf: id => sessions.get(id) ?? null });
const sha = "a".repeat(64);
const server = { timeout() {} };

function session(id: string, parentSession?: string): string {
	const file = join(dir, `${id}.jsonl`);
	writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, cwd: dir, timestamp: new Date().toISOString(), parentSession })}\n`);
	sessions.set(id, file);
	return file;
}
function copy(id: string, version: string, text: string): void {
	const folder = join(dir, id, "artifact-versions");
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, version), text);
}
async function request(path: string, headers: Record<string, string> = {}): Promise<Response> {
	const req = new Request(`http://127.0.0.1:4317${path}`, { headers: { host: "127.0.0.1:4317", ...headers } });
	return routes[new URL(req.url).pathname]!.GET!(req, server);
}
async function link(id: string, version: string): Promise<string> {
	const response = await request(`/api/artifact-link?${new URLSearchParams({ session: id, version })}`, { authorization: `Bearer ${token}` });
	expect(response.status).toBe(200);
	return (await response.json()).url;
}

describe("artifact routes", () => {
	test("only a bearer opens the link route and the link carries no bearer", async () => {
		expect((await request(`/api/artifact-link?session=main&version=${sha}.html`)).status).toBe(401);
		expect(await link("main", `${sha}.html`)).not.toContain(token);
		expect((await request("/api/artifact-link?session=main&version=../bad", { authorization: `Bearer ${token}` })).status).toBe(400);
	});
	test("each kind serves its bytes with its own sandbox policy and immutable headers", async () => {
		session("main");
		const policies = {
			html: "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'",
			markdown: "sandbox; default-src 'none'",
			svg: "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
		};
		const types = { html: "text/html; charset=utf-8", markdown: "text/plain; charset=utf-8", svg: "image/svg+xml" };
		for (const kind of ARTIFACT_KINDS) {
			const version = `${sha}.${kind}`;
			copy("main", version, `saved ${kind}`);
			const response = await request(await link("main", version));
			expect(response.status).toBe(200);
			expect(await response.text()).toBe(`saved ${kind}`);
			expect(response.headers.get("content-type")).toBe(types[kind]);
			expect(response.headers.get("content-security-policy")).toBe(policies[kind]);
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
		}
	});
	test("wrong, missing, another session's, and another version's caps fail", async () => {
		const url = await link("main", `${sha}.html`);
		expect((await request(url.replace(/cap=[^&]+/, "cap=wrong"))).status).toBe(403);
		expect((await request(url.split("&cap=")[0]!)).status).toBe(403);
		expect((await request(url.replace("session=main", "session=other"))).status).toBe(403);
		expect((await request(url.replace(`${sha}.html`, `${sha}.svg`))).status).toBe(403);
	});
	test("a missing copy or session is 404", async () => {
		session("missing");
		expect((await request(await link("missing", `${sha}.html`))).status).toBe(404);
		expect((await request(await link("unknown", `${sha}.html`))).status).toBe(404);
	});
	test("forks find copies through the header's parent link", async () => {
		const parent = session("parent");
		copy("parent", `${sha}.html`, "ancestor copy");
		const child = session("child", parent);
		session("grandchild", child);
		const response = await request(await link("grandchild", `${sha}.html`));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ancestor copy");
	});
	test("a parent link that names a session id, as some omp forks write, is followed through the session's file", async () => {
		session("id-parent");
		copy("id-parent", `${sha}.svg`, "<svg/>");
		session("id-child", "id-parent");
		const response = await request(await link("id-child", `${sha}.svg`));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<svg/>");
	});
	test("parent cycles stop at the depth cap", async () => {
		const file = join(dir, "cycle.jsonl");
		session("cycle", file);
		expect((await request(await link("cycle", `${sha}.html`))).status).toBe(404);
	});
});
