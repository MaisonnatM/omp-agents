import { afterEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { attachKeeper, type KeeperLink, listKeepers, startKeeper } from "./keeper-link";
import { STOP } from "./keeper-wire";
import { rpc, rpcFrameFile, type RpcHostTool, utils } from "./omp/modules";
import type { RpcClient } from "./omp/rpc";

/**
 * A stand-in for `omp --mode rpc-ui`: omp's `ready` line, then a response to each command. `ask` raises a question,
 * `call` a host tool call of tool `frame.tool`, and `big` one over omp's 1 MB line limit, which it writes as `rpc_chunk`s
 * as omp does. `job` starts a background job and `exit` exits. `get_state` reports, as `sessionName`, what it heard: how
 * often it negotiated, the answers, the host tool results, and the job's pid. Started with `v1`, it offers protocol 1 only.
 */
const FAKE_OMP = `
const heard = { negotiations: 0, answers: [], tools: [], job: null };
const out = frame => process.stdout.write(JSON.stringify(frame) + "\\n");
if (process.argv[2] === "fail") {
	console.error("no model is signed in");
	process.exit(3);
}
out({ type: "ready", protocolVersion: 1, supportedProtocolVersions: process.argv[2] === "v1" ? [1] : [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
	buffer += new TextDecoder().decode(chunk);
	let end;
	while ((end = buffer.indexOf("\\n")) !== -1) {
		const frame = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		const reply = data => out({ id: frame.id, type: "response", command: frame.type, success: true, data });
		if (frame.type === "negotiate_protocol") {
			heard.negotiations++;
			reply({ protocolVersion: 2 });
		} else if (frame.type === "ask") {
			out({ type: "extension_ui_request", id: "q1", method: "confirm", title: "Go on?" });
			reply({});
		} else if (frame.type === "job") {
			// A background job in a session of its own, as omp's bash tool starts one.
			heard.job = Bun.spawn(["sleep", "60"], { detached: true, stdout: "ignore" }).pid;
			out({ type: "tool_execution_end", toolCallId: "c0", toolName: "bash", isError: false });
			reply({});
		} else if (frame.type === "exit") {
			process.exit(0);
		} else if (frame.type === "call") {
			out({ type: "host_tool_call", id: "t1", toolCallId: "c1", toolName: frame.tool, arguments: {} });
			reply({});
		} else if (frame.type === "big") {
			const bytes = Buffer.from(JSON.stringify({ type: "host_tool_call", id: "t2", toolCallId: "c2", toolName: "slow", arguments: { pad: "x".repeat(1_500_000) } }));
			const size = 256 * 1024;
			const count = Math.ceil(bytes.length / size);
			for (let index = 0; index < count; index++)
				out({ type: "rpc_chunk", chunkId: "k1", index, count, byteLength: bytes.length, data: bytes.subarray(index * size, (index + 1) * size).toString("base64") });
			reply({});
		} else if (frame.type === "extension_ui_response") heard.answers.push(frame.id + ":" + frame.confirmed);
		else if (frame.type === "host_tool_result") heard.tools.push(frame.id + ":" + frame.result.content[0].text);
		else if (frame.type === "get_state") reply({ sessionId: "s1", sessionName: JSON.stringify(heard), isStreaming: false, fastModeEnabled: false, fastModeActive: false, queuedMessages: { steering: [], followUp: [] } });
		else if (frame.type === "set_host_tools") reply({ toolNames: frame.tools.map(tool => tool.name) });
		else reply({});
	}
}
`;

const dirs: string[] = [];
const links: KeeperLink[] = [];
afterEach(async () => {
	for (const link of links.splice(0)) {
		link.process.kill();
		await link.process.exited;
	}
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A short directory, since a Unix socket's path holds at most 103 bytes. */
function scratch(): string {
	const dir = mkdtempSync(join("/tmp", "okt-"));
	dirs.push(dir);
	writeFileSync(join(dir, "omp.ts"), FAKE_OMP);
	return dir;
}

const META = { startedAt: 1_700_000_000_000, cwd: "/tmp/project" };

function start(dir: string, ...args: string[]): Promise<KeeperLink> {
	return startKeeper(dir, "s1", { cwd: dir, argv: [process.execPath, join(dir, "omp.ts"), ...args], env: { ...process.env }, frameModule: rpcFrameFile, meta: META });
}

/** omp's own client on `link`, as the server drives a session; `frames` collects the dialogs it hears. */
async function drive(link: KeeperLink, tools: RpcHostTool[] = []): Promise<{ client: RpcClient; frames: Record<string, unknown>[] }> {
	const frames: Record<string, unknown>[] = [];
	const [forClient, forTest] = link.process.stdout.tee();
	void (async () => {
		for await (const line of utils.readJsonl(forTest)) if (typeof line === "object" && line !== null && "type" in line && line.type === "extension_ui_request") frames.push(line as Record<string, unknown>);
	})();
	const client = new rpc.RpcClient({ args: [], customTools: tools, spawn: async () => ({ ...link.process, stdout: forClient }) });
	await client.start();
	return { client, frames };
}

const heard = async (client: RpcClient): Promise<{ negotiations: number; answers: string[]; tools: string[]; job: number | null }> => JSON.parse((await client.getState()).sessionName ?? "null");

/** A host tool named `slow` that never ends, and a promise that settles once it runs. */
function slowTool(): { tool: RpcHostTool; running: Promise<void> } {
	const running = Promise.withResolvers<void>();
	const tool: RpcHostTool = {
		name: "slow",
		label: "Slow",
		description: "Never ends.",
		parameters: { type: "object", properties: {} },
		loadMode: "essential",
		execute: () => {
			running.resolve();
			return Promise.withResolvers<string>().promise;
		},
	};
	return { tool, running: running.promise };
}

/** Polls `check`: the keeper and the stand-in omp are real processes, whose progress no fake clock drives or signals here. */
async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
	for (let tries = 0; tries < 500; tries++) {
		if (await check()) return;
		await Bun.sleep(10);
	}
	throw new Error("timed out");
}

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("session keeper", () => {
	test("omp outlives the server that started it, and the next server attaches to it with its question still open", async () => {
		const dir = scratch();
		const first = await start(dir);
		const { client } = await drive(first);
		first.process.stdin.write(`${JSON.stringify({ type: "ask", id: "x" })}\n`);
		await eventually(async () => (await heard(client)).negotiations === 1);
		first.detach();
		expect(await first.ended).toBe("detach");
		expect(listKeepers(dir)).toEqual(["s1"]);

		const second = await attachKeeper(dir, "s1");
		links.push(second);
		expect([second.meta, second.process.pid]).toEqual([META, first.process.pid]);
		const { client: next, frames } = await drive(second);
		await eventually(() => frames.length === 1);
		expect(frames[0]).toMatchObject({ id: "q1", method: "confirm", title: "Go on?" });
		second.process.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: "q1", confirmed: true })}\n`);
		// omp answered the second client's negotiation as it did the first's, and heard the second client's answer.
		await eventually(async () => (await heard(next)).answers.length === 1);
		expect(await heard(next)).toEqual({ negotiations: 2, answers: ["q1:true"], tools: [], job: null });

		second.detach();
		await second.process.exited;
		const third = await attachKeeper(dir, "s1");
		links.push(third);
		const { client: last, frames: after } = await drive(third);
		await heard(last);
		expect(after).toEqual([]);
	});

	test("a host tool call the departed server never finished fails, chunked or not, so omp's turn goes on", async () => {
		const dir = scratch();
		const first = await start(dir);
		const { tool, running } = slowTool();
		await drive(first, [tool]);
		first.process.stdin.write(`${JSON.stringify({ type: "big", id: "x" })}\n`);
		await running;
		first.detach();

		const second = await attachKeeper(dir, "s1");
		links.push(second);
		const { client } = await drive(second);
		await eventually(async () => (await heard(client)).tools.length === 1);
		expect((await heard(client)).tools[0]).toStartWith("t2:The dashboard restarted while this tool ran.");
	});

	test("the first host tool call after a server attaches runs on that server", async () => {
		const dir = scratch();
		const first = await start(dir);
		await drive(first);
		first.detach();

		const second = await attachKeeper(dir, "s1");
		links.push(second);
		const quick: RpcHostTool = { name: "quick", label: "Quick", description: "Answers.", parameters: { type: "object", properties: {} }, loadMode: "essential", execute: async () => "ran" };
		const { client } = await drive(second, [quick]);
		second.process.stdin.write(`${JSON.stringify({ type: "call", id: "x", tool: "quick" })}\n`);
		await eventually(async () => (await heard(client)).tools.length === 1);
		expect((await heard(client)).tools).toEqual(["t1:ran"]);
	});

	test("a connection that never joined cannot stop omp", async () => {
		const dir = scratch();
		const link = await start(dir);
		links.push(link);
		const { client } = await drive(link);
		const stranger = createConnection(join(dir, "s1.sock")).resume();
		await once(stranger, "connect");
		stranger.end(`${JSON.stringify(STOP)}\n`);
		await once(stranger, "close");
		expect(await heard(client)).toMatchObject({ negotiations: 1 });
		expect(alive(link.process.pid)).toBe(true);
	});

	test("End session stops omp, the background jobs it started, and its keeper, and leaves no files", async () => {
		const dir = scratch();
		const link = await start(dir);
		const { client } = await drive(link);
		link.process.stdin.write(`${JSON.stringify({ type: "job", id: "x" })}\n`);
		await eventually(async () => (await heard(client)).job !== null);
		const { job } = await heard(client);
		await client.stop();
		expect(alive(link.process.pid)).toBe(false);
		expect(alive(job ?? 0)).toBe(false);
		await eventually(() => readdirSync(dir).filter(name => name !== "omp.ts").length === 0);
		expect(Bun.spawnSync(["pgrep", "-f", join(dir, "s1.sock")]).stdout.toString()).toBe("");
	});

	test("omp exiting on its own takes the background jobs it started, and its keeper, with it", async () => {
		const dir = scratch();
		const link = await start(dir);
		const { client } = await drive(link);
		link.process.stdin.write(`${JSON.stringify({ type: "job", id: "x" })}\n`);
		await eventually(async () => (await heard(client)).job !== null);
		const { job } = await heard(client);
		// The keeper notes omp's processes 1 s after a tool call ends, in its own process, which no fake clock reaches.
		await Bun.sleep(1_500);
		link.process.stdin.write(`${JSON.stringify({ type: "exit", id: "y" })}\n`);
		expect(await link.ended).toBe("exit");
		expect(alive(job ?? 0)).toBe(false);
		await eventually(() => Bun.spawnSync(["pgrep", "-f", join(dir, "s1.sock")]).stdout.toString() === "");
	});

	test("a client of an omp without protocol 2 joins on the greeting, and the next one takes over from it", async () => {
		const dir = scratch();
		const first = await start(dir, "v1");
		await drive(first);
		first.detach();

		const second = await attachKeeper(dir, "s1");
		links.push(second);
		const { client } = await drive(second);
		second.process.stdin.write(`${JSON.stringify({ type: "ask", id: "x" })}\n`);
		second.process.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: "q1", confirmed: false })}\n`);
		await eventually(async () => (await heard(client)).answers.length === 1);
		expect(await heard(client)).toEqual({ negotiations: 0, answers: ["q1:false"], tools: [], job: null });
	});

	test("an omp that exits before it is ready fails the start with what it wrote to stderr", async () => {
		const dir = scratch();
		await expect(start(dir, "fail")).rejects.toThrow("no model is signed in");
		expect(existsSync(join(dir, "s1.sock"))).toBe(false);
	});

	test("a keeper that is gone leaves nothing to attach to, and its files go", async () => {
		const dir = scratch();
		writeFileSync(join(dir, "s1.sock"), "");
		writeFileSync(join(dir, "s1.log"), "");
		writeFileSync(join(dir, "s2.log"), "");
		expect(listKeepers(dir)).toEqual(["s1"]);
		await expect(attachKeeper(dir, "s1")).rejects.toThrow();
		expect(readdirSync(dir).sort()).toEqual(["omp.ts"]);
	});
});
