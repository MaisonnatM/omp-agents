import { existsSync } from "node:fs";
import { readFile, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { agentDir } from "./config";
import type { RpcLaunch } from "./rpc";
import { ompTemplateDir } from "../server/resources";
import { loader } from "./modules";
import { REPLAY_MARKER, replayMarkerOf } from "../shared/replay";
import type { ReplayMarker } from "../shared/replay";
import { packageDir } from "./install";

export interface ReplayLaunch extends RpcLaunch { readyToken: string }
export interface ReplayResume { launch: RpcLaunch; marker: ReplayMarker | null; readyToken: string | null }
export async function writeReplayConfig(file: string): Promise<string> {
	const config = `${file}.replay.yml`;
	const temporary = `${config}.${randomUUID()}.tmp`;
	const output = await open(temporary, "wx", 0o600);
	try {
		try {
			await output.writeFile("lsp:\n  lazy: true\n  formatOnWrite: false\n  diagnosticsOnWrite: false\n  diagnosticsOnEdit: false\n");
		} finally {
			await output.close();
		}
		await rename(temporary, config);
	} finally {
		await rm(temporary, { force: true });
	}
	return config;
}

export function replayLaunch(config: string, launch: RpcLaunch): ReplayLaunch {
	const readyToken = randomUUID();
	const args = [...launch.args, "--config", config, "--replay-safe-edits", "--replay-package", packageDir, "--replay-nonce", readyToken];
	for (const name of ["request-log", "replay-guard"]) if (!existsSync(join(agentDir, "extensions", `${name}.ts`))) args.push("-e", join(ompTemplateDir, "agent", "extensions", `${name}.ts`));
	return { ...launch, args, readyToken };
}
export async function launchForReplayResume(file: string, launch: RpcLaunch): Promise<ReplayResume> {
	const entries = await loader.loadEntriesFromFile(file);
	const entry = entries.findLast(entry => entry.type === "custom" && entry.customType === REPLAY_MARKER);
	const marker = replayMarkerOf(entry?.data);
	if (entry && !marker) throw new Error("Replay protection metadata is invalid. This file cannot be safely resumed.");
	if (!marker) return { launch, marker: null, readyToken: null };
	const protectedLaunch = replayLaunch(await writeReplayConfig(file), launch);
	return { launch: protectedLaunch, marker, readyToken: protectedLaunch.readyToken };
}
export async function requireReplayReady(file: string, id: string, readyToken: string): Promise<void> {
	const until = Date.now() + 2000;
	do {
		const text = await readFile(file, "utf8");
		const ready = text.split("\n").some(line => {
			try {
				const entry = JSON.parse(line);
				return entry.type === "custom" && entry.customType === "omp-agents-replay-ready" && entry.data?.id === id && entry.data?.v === 1 && entry.data?.nonce === readyToken;
			} catch { return false; }
		});
		if (ready) return;
		await Bun.sleep(25);
	} while (Date.now() < until);
	throw new Error("The replay protection extension did not confirm readiness. No prompt was sent.");
}
