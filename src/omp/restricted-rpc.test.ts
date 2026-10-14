import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isObject } from "../json";
import { starterPresets } from "../shared/presets";
import { rpcFrames, utils } from "./modules";

async function inventory(presetId: string): Promise<string[]> {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-restricted-"));
	const preset = starterPresets([]).find(preset => preset.id === presetId)!;
	const child = Bun.spawn([process.execPath, join(import.meta.dir, "restricted-rpc.ts"), JSON.stringify(preset.tools)], {
		cwd: dir,
		env: { ...process.env, PI_CODING_AGENT_DIR: join(dir, "agent") },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		timeout: 15_000,
	});
	try {
		child.stdin.write(JSON.stringify({ id: "inventory", type: "get_state" }) + "\n");
		await child.stdin.flush();
		const decoder = new rpcFrames.RpcFrameDecoder();
		for await (const line of utils.readJsonl(child.stdout)) {
			const frame = decoder.push(line);
			if (!isObject(frame) || frame.id !== "inventory") continue;
			if (!isObject(frame.data) || !Array.isArray(frame.data.dumpTools)) throw new Error("RPC returned no tool inventory.");
			return frame.data.dumpTools.map(tool => {
				if (!isObject(tool) || typeof tool.name !== "string") throw new Error("RPC returned an invalid tool name.");
				return tool.name;
			}).sort();
		}
		throw new Error(`Restricted RPC exited without answering: ${await new Response(child.stderr).text()}`);
	} finally {
		child.kill();
		await child.exited;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("Minimal exposes only bash and edit over live RPC", async () => {
	expect(await inventory("minimal")).toEqual(["bash", "edit"]);
}, 20_000);

test("Review keeps LSP while excluding every tool outside its read-only allowlist", async () => {
	const tools = await inventory("review");
	expect(tools).toContain("lsp");
	const allowed = ["read", "grep", "glob", "find", "lsp", "ast_grep", "web_search"];
	expect(tools.filter(tool => !allowed.includes(tool))).toEqual([]);
}, 20_000);
