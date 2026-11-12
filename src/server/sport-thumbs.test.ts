import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RouteKit } from "./route-kit";
import { sportThumbRoutes } from "./sport-thumbs";

const kit: RouteKit = {
	get: handle => async req => handle(new URL(req.url).searchParams, req),
	media: handle => async req => handle(new URL(req.url).searchParams, req),
	capability: (_purpose, handle) => async req => handle(req, new URL(req.url)),
	capabilityKey: purpose => purpose,
	write: () => async () => new Response(),
};
const server = { timeout: () => {} };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

let dir: string;
let fetched: string[];

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "sport-thumbs-"));
	fetched = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function thumb(id: string, youtube: (url: string) => Response): Promise<Response> {
	const routes = sportThumbRoutes(kit, {
		dir,
		fetch: async url => {
			fetched.push(url);
			return youtube(url);
		},
	});
	return routes["/api/sport/thumb"]!.GET!(new Request(`http://localhost/api/sport/thumb?id=${encodeURIComponent(id)}`), server);
}

describe("GET /api/sport/thumb", () => {
	test("refuses an id that is not 11 characters, and asks YouTube nothing", async () => {
		for (const id of ["", "3IdQnBtnGj", "3IdQnBtnGjQx", "../../etc/pa", "3IdQnBtnG/Q"]) {
			expect((await thumb(id, () => new Response(JPEG))).status).toBe(400);
		}
		expect(fetched).toEqual([]);
	});

	test("answers 404 when YouTube has no image, and keeps nothing", async () => {
		const response = await thumb("gone0000000", () => new Response("", { status: 404 }));
		expect(response.status).toBe(404);
		expect(await readdir(dir)).toEqual([]);
	});

	test("fetches hqdefault.jpg once, then serves it from the disk", async () => {
		const first = await thumb("3IdQnBtnGjQ", () => new Response(JPEG));
		expect(first.status).toBe(200);
		expect(first.headers.get("content-type")).toBe("image/jpeg");
		expect(new Uint8Array(await first.arrayBuffer())).toEqual(JPEG);
		const second = await thumb("3IdQnBtnGjQ", () => new Response("", { status: 500 }));
		expect(second.status).toBe(200);
		expect(new Uint8Array(await second.arrayBuffer())).toEqual(JPEG);
		expect(fetched).toEqual(["https://i.ytimg.com/vi/3IdQnBtnGjQ/hqdefault.jpg"]);
		expect(await readdir(dir)).toEqual(["3IdQnBtnGjQ.jpg"]);
	});
});
