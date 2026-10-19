import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachKeeper, type KeeperLink, listKeepers, startKeeper } from "./keeper-link";
import { rpc, type RpcHostTool, utils } from "./omp/modules";
import type { RpcClient } from "./omp/rpc";

/**
 * A stand-in for `omp --mode rpc-ui`: omp's `ready` line, then a response to each command. `ask` raises a question and
 * `call` a host tool call; `get_state` reports, as `sessionName`, what it heard: how often it negotiated, the answers,
 * and the host tool results.
 */
const FAKE_OMP = `
const heard = { negotiations: 0, answers: [], tools: [], job: null };
const out = frame => process.stdout.write(JSON.stringify(frame) + "\\n");
if (process.argv[2] === "fail") {
	console.error("no model is signed in");
	process.exit(3);
}
out({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });
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
			// A background job in a process group of its own, as omp's bash tool starts one.
			heard.job = Bun.spawn(["sleep", "60"], { detached: true, stdout: "ignore" }).pid;
			reply({});
		} else if (frame.type === "call") {
			out({ type: "host_tool_call", id: "t1", toolCallId: "c1", toolName: "slow", arguments: {} });
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

/** Polls `check`: the keeper and the stand-in omp are real processes, whose progress no fake clock drives or signals here. */
async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
	for (let tries = 0; tries < 200; tries++) {
		if (await check()) return;
		await Bun.sleep(10);
	}
	throw new Error("timed out");
}

describe("session keeper", () => {
	test("omp outlives the server that started it, and the next server attaches to it with its question still open", async () => {
		const dir = scratch();
		const first = await startKeeper(dir, "s1", dir, [process.execPath, join(dir, "omp.ts")], { ...process.env }, META);
		const { client } = await drive(first);
		first.process.stdin.write(`${JSON.stringify({ type: "ask", id: "x" })}\n`);
		await eventually(async () => (await heard(client)).negotiations === 1);
		first.detach();
		await first.process.exited;
		expect(listKeepers(dir)).toEqual(["s1"]);

		const second = await attachKeeper(dir, "s1");
		links.push(second);
		expect([second.meta, second.process.pid]).toEqual([META, first.process.pid]);
		const { client: next, frames } = await drive(second);
		await eventually(() => frames.length === 1);
		expect(frames[0]).toMatchObject({ id: "q1", method: "confirm", title: "Go on?" });
		second.process.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: "q1", confirmed: true })}\n`);
		// The keeper answered the second client's negotiation itself, and omp heard the answer.
		await eventually(async () => (await heard(next)).answers.length === 1);
		expect(await heard(next)).toEqual({ negotiations: 1, answers: ["q1:true"], tools: [], job: null });

		second.detach();
		await second.process.exited;
		const third = await attachKeeper(dir, "s1");
		links.push(third);
		const { client: last, frames: after } = await drive(third);
		await heard(last);
		expect(after).toEqual([]);
	});

	test("a host tool call the departed server never finished fails, so omp's turn goes on", async () => {
		const dir = scratch();
		const first = await startKeeper(dir, "s1", dir, [process.execPath, join(dir, "omp.ts")], { ...process.env }, META);
		const running = Promise.withResolvers<void>();
		const slow: RpcHostTool = { name: "slow", label: "Slow", description: "Never ends.", parameters: { type: "object", properties: {} }, loadMode: "essential", execute: () => { running.resolve(); return new Promise(() => {}); } };
		await drive(first, [slow]);
		first.process.stdin.write(`${JSON.stringify({ type: "call", id: "x" })}\n`);
		await running.promise;
		first.detach();

		const second = await attachKeeper(dir, "s1");
		links.push(second);
		const { client } = await drive(second);
		await eventually(async () => (await heard(client)).tools.length === 1);
		expect((await heard(client)).tools[0]).toStartWith("t1:The dashboard restarted while this tool ran.");
	});

	test("End session stops omp, the background jobs it started, and its keeper, and leaves no files", async () => {
		const dir = scratch();
		const link = await startKeeper(dir, "s1", dir, [process.execPath, join(dir, "omp.ts")], { ...process.env }, META);
		const { client } = await drive(link);
		link.process.stdin.write(`${JSON.stringify({ type: "job", id: "x" })}\n`);
		await eventually(async () => (await heard(client)).job !== null);
		const { job } = await heard(client);
		await client.stop();
		expect(() => process.kill(link.process.pid, 0)).toThrow();
		expect(() => process.kill(job ?? 0, 0)).toThrow();
		await eventually(() => readdirSync(dir).filter(name => name !== "omp.ts").length === 0);
		expect(Bun.spawnSync(["pgrep", "-f", join(dir, "s1.sock")]).stdout.toString()).toBe("");
	});

	test("an omp that exits before it is ready fails the start with what it wrote to stderr", async () => {
		const dir = scratch();
		await expect(startKeeper(dir, "s1", dir, [process.execPath, join(dir, "omp.ts"), "fail"], { ...process.env }, META)).rejects.toThrow("no model is signed in");
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
