import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLAIN_LAUNCH } from "./rpc";
import { replayLaunch, requireReplayReady, writeReplayConfig } from "./replay-launch";

const directories: string[] = [];
function fixture(): string {
	const directory = mkdtempSync(join(tmpdir(), "omp-replay-launch-test-"));
	directories.push(directory);
	return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("the private LSP overlay replaces a symlink without changing its target", async () => {
	const directory = fixture();
	const source = join(directory, "original.yml");
	const file = join(directory, "session.jsonl");
	writeFileSync(source, "original configuration\n");
	symlinkSync(source, `${file}.replay.yml`);
	const config = await writeReplayConfig(file);
	expect(readFileSync(source, "utf8")).toBe("original configuration\n");
	expect(readFileSync(config, "utf8")).toBe("lsp:\n  lazy: true\n  formatOnWrite: false\n  diagnosticsOnWrite: false\n  diagnosticsOnEdit: false\n");
	expect(statSync(config).mode & 0o777).toBe(0o600);
});

test("protected launch keeps the existing advertised-tool arguments and uses fresh readiness nonces", () => {
	const launch = { ...PLAIN_LAUNCH, args: [...PLAIN_LAUNCH.args, "--tools", "read,edit,bash"] };
	const first = replayLaunch("/tmp/replay.yml", launch);
	const second = replayLaunch("/tmp/replay.yml", launch);
	expect(first.args.slice(0, launch.args.length)).toEqual(launch.args);
	expect(first.args).not.toContain("--no-lsp");
	expect(first.args).toContain("--replay-safe-edits");
	expect(first.args).toContain(first.readyToken);
	expect(first.readyToken).not.toBe(second.readyToken);
});

test("a ready acknowledgement from another launch cannot admit a prompt", async () => {
	const file = join(fixture(), "session.jsonl");
	const ready = (nonce: string) => JSON.stringify({ type: "custom", customType: "omp-agents-replay-ready", data: { v: 1, id: "replay-id", nonce } });
	writeFileSync(file, `${ready("old-launch")}\n`);
	await expect(requireReplayReady(file, "replay-id", "fresh-launch")).rejects.toThrow("readiness");
	writeFileSync(file, `${ready("old-launch")}\n${ready("fresh-launch")}\n`);
	await requireReplayReady(file, "replay-id", "fresh-launch");
});
