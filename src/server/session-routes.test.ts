import { describe, expect, test } from "bun:test";
import type { RouteKit, SessionRoutesEnv } from "./route-kit";
import { sessionRoutes } from "./session-routes";

const handler = async (): Promise<Response> => new Response();
const kit: RouteKit = {
	get: handle => async req => handle(new URL(req.url).searchParams, req),
	media: handle => async req => handle(new URL(req.url).searchParams, req),
	capability: () => ({ sign: () => "", serve: () => async () => new Response() }),
	write: () => handler,
};
const unused = (): never => {
	throw new Error("not read by these routes");
};
const env: SessionRoutesEnv = {
	knownWorkspaces: () => ["/w/app"],
	addedCwds: () => [],
	changeWorkspaces: unused,
	changeProjectTrust: unused,
	summaryOf: unused,
	foreignUsage: unused,
	placeOf: unused,
	learnHeads: unused,
	searchConversations: unused,
	sourceControl: unused,
	changeSourceControl: unused,
};
const server = { timeout: () => {} };

async function read(query: string): Promise<Response> {
	return sessionRoutes(kit, env)["/api/pull-requests"]!.GET!(new Request(`http://localhost/api/pull-requests${query}`), server);
}

describe("GET /api/pull-requests", () => {
	test("refuses a directory no session ran in", async () => {
		expect((await read("?cwd=/w/other")).status).toBe(404);
	});
});
