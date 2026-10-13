import { afterEach, expect, spyOn, test } from "bun:test";
import * as proc from "../proc";
import { ApiError, signedFetch } from "../signed-fetch";
import { listMcpTools, mcpBearer, type McpServer, McpRefused, McpUnauthorized, writeMcpServer } from "./mcp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const servers: Bun.Server<undefined>[] = [];

// Real HTTP discovery runs apart from browser tests that replace the process-wide fetch.
if (!process.env.MCP_DISCOVERY_CHILD) {
	test("remote MCP discovery consumer regressions", async () => {
		const child = Bun.spawn([process.execPath, "test", import.meta.path], {
			env: { ...process.env, MCP_DISCOVERY_CHILD: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		expect({ code, output: code ? out + err : "" }).toEqual({ code: 0, output: "" });
	});
} else {
const dirs: string[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) await server.stop(true);
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function remote() {
	let status = 200;
	let lists = 0;
	const headers: Headers[] = [];
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			if (status !== 200) return new Response("refused", { status });
			if (req.method !== "POST") return new Response(null, { status: 405 });
			const body = await req.json();
			if (!body.id) return new Response(null, { status: 202 });
			let result: unknown;
			if (body.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } };
			else {
				lists++;
				headers.push(req.headers);
				result = body.params?.cursor ? { tools: [{ name: "second" }] } : { tools: [{ name: "first", description: " First tool " }], nextCursor: "page2" };
			}
			return Response.json({ jsonrpc: "2.0", id: body.id, result });
		},
	});
	servers.push(server);
	const url = `http://127.0.0.1:${server.port}/mcp`;
	const found: McpServer = { name: `test-${server.port}`, url, credentialId: `test:${server.port}`, config: { type: "http", url, headers: { "X-Configured": "kept" } } };
	return { found, headers, lists: () => lists, status: (value: number) => { status = value; } };
}

test("discovery follows cursors, shares equivalent reads, preserves headers, and separates changed configs", async () => {
	const r = remote();
	const expected = [{ name: "first", description: " First tool " }, { name: "second" }];
	const [a, b] = await Promise.all([listMcpTools(r.found, false, false), listMcpTools({ ...r.found }, false, false)]);
	expect(a).toEqual(expected);
	expect(b).toEqual(expected);
	expect(r.lists()).toBe(2);
	expect(r.headers[0].get("X-Configured")).toBe("kept");
	expect(r.headers[0].get("Authorization")).toBeNull();
	await listMcpTools(r.found, false, true);
	expect(r.lists()).toBe(4);
	await listMcpTools({ ...r.found, config: { ...r.found.config, headers: { "X-Configured": "changed" } } }, false, false);
	expect(r.lists()).toBe(6);
	expect(r.headers[4].get("X-Configured")).toBe("changed");
});

test("discovery errors are not cached and HTTP statuses remain available to integration callers", async () => {
	const r = remote();
	r.status(401);
	await expect(listMcpTools(r.found, false, false)).rejects.toBeInstanceOf(McpUnauthorized);
	r.status(403);
	try {
		await listMcpTools(r.found, false, false);
		throw new Error("expected 403");
	} catch (err) {
		expect(err).toBeInstanceOf(ApiError);
		if (err instanceof ApiError) expect(err.status).toBe(403);
	}
	r.status(200);
	expect(await listMcpTools(r.found, false, false)).toHaveLength(2);
});

test("config writes invalidate discovery at the facade, without caller-managed cache drops", async () => {
	const r = remote();
	await listMcpTools(r.found, false, false);
	const dir = await mkdtemp(join(tmpdir(), "mcp-discovery-"));
	dirs.push(dir);
	await writeMcpServer(join(dir, "mcp.json"), r.found.name, r.found.config);
	await listMcpTools(r.found, false, false);
	expect(r.lists()).toBe(4);
});

test("service API and discovery refusals invalidate signed and unsigned lists sharing a credential", async () => {
	const r = remote();
	const token = spyOn(proc, "runChecked").mockResolvedValue("test-token");
	try {
		await listMcpTools(r.found, false, false);
		await listMcpTools(r.found, true, false);
		expect(r.lists()).toBe(4);
		expect(r.headers[2].get("Authorization")).toBe("Bearer test-token");
		expect(token).toHaveBeenCalledTimes(1);
		r.status(401);
		await expect(signedFetch(() => mcpBearer(r.found))(r.found.url)).rejects.toBeInstanceOf(McpRefused);
		r.status(200);
		await listMcpTools(r.found, false, false);
		await listMcpTools(r.found, true, false);
		expect(r.lists()).toBe(8);
		expect(token).toHaveBeenCalledTimes(2);
		r.status(401);
		await expect(listMcpTools(r.found, true, true)).rejects.toBeInstanceOf(McpUnauthorized);
		r.status(200);
		await listMcpTools(r.found, true, false);
		expect(token).toHaveBeenCalledTimes(3);
	} finally {
		token.mockRestore();
	}
});
}
