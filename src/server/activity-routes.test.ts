import { describe, expect, test } from "bun:test";
import type { ActivityRead } from "../shared/activity";
import { activityRoutes } from "./activity-routes";
import type { RouteKit, Routes } from "./routes";

const handler = async (): Promise<Response> => new Response();
const kit: RouteKit = {
	get: handle => async req => handle(new URL(req.url).searchParams, req),
	media: handle => async req => handle(new URL(req.url).searchParams, req),
	write: () => handler,
};
const OTHERS: Routes = {
	"/api/todo": { GET: handler, PUT: handler },
	"/api/tickets": { GET: handler },
	"/api/ticket/new": { PUT: handler },
};
const store = { rows: () => [], lastUsed: () => [{ kind: "view" as const, key: "home", at: 1 }] };
const server = { timeout: () => {} };

async function read(query: string): Promise<Response> {
	return activityRoutes(kit, store, OTHERS)["/api/activity"]!.GET!(new Request(`http://localhost/api/activity${query}`), server);
}

describe("activityRoutes", () => {
	test("lists every other route that takes a PUT, and only those, as server actions", async () => {
		const answer = (await (await read("")).json()) as ActivityRead;
		expect(answer.range).toBe("30d");
		expect(answer.serverActions).toEqual(["/api/todo", "/api/ticket/new"]);
		expect(answer.lastUsed).toEqual([{ kind: "view", key: "home", at: 1 }]);
	});

	test("refuses an unknown range", async () => {
		expect((await read("?range=1y")).status).toBe(400);
	});
});
