import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelUpdate } from "../shared/notices";
import { Notices, type NoticeSources } from "./notices";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function noticesPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-notices-"));
	dirs.push(dir);
	return join(dir, "notices.json");
}

const opus: ModelUpdate = {
	provider: "anthropic",
	from: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
	to: { id: "claude-opus-5-6", name: "Claude Opus 5.6" },
	uses: ["default", "smol fallbacks"],
};
const OPUS_ID = "model:anthropic/claude-opus-5-5>claude-opus-5-6";

/** Sources whose answers a test changes as it goes: `installed` moves when `updateOmp` succeeds. */
function sources(state: { latest: string | null; installed: string; models: ModelUpdate[]; fail?: string }): NoticeSources {
	return {
		latestOmp: async () => {
			if (state.fail) throw new Error(state.fail);
			return state.latest;
		},
		installedOmp: () => state.installed,
		updateOmp: async latest => {
			state.installed = latest;
			return latest;
		},
		modelUpdates: async () => {
			if (state.fail) throw new Error(state.fail);
			return state.models;
		},
		upgradeModel: async update => {
			state.models = state.models.filter(model => model !== update);
		},
	};
}

describe("Notices", () => {
	test("a newer omp and a newer model each make one notice; seen and clear survive a restart, and a newer release is a new notice", async () => {
		const path = noticesPath();
		const state = { latest: "18.8.4", installed: "18.8.0", models: [opus] };
		const first = new Notices(path, sources(state), () => {});
		await first.check();
		expect(first.list.map(({ id, seen, status }) => [id, seen, status.state])).toEqual([
			["omp:18.8.4", false, "available"],
			[OPUS_ID, false, "available"],
		]);
		await first.apply("omp:18.8.4", "seen");
		await first.apply(OPUS_ID, "clear");

		const second = new Notices(path, sources(state), () => {});
		await second.check();
		expect(second.list.map(({ id, seen }) => [id, seen])).toEqual([["omp:18.8.4", true]]);

		state.latest = "18.9.0";
		await second.check();
		expect(second.list.map(({ id, seen }) => [id, seen])).toEqual([["omp:18.9.0", false]]);
	});

	test("an update shows its outcome after the check no longer finds it, and a failed one can run again", async () => {
		const state = { latest: "18.8.4", installed: "18.8.0", models: [opus] };
		const notices = new Notices(noticesPath(), sources(state), () => {});
		await notices.check();

		await notices.apply(OPUS_ID, "update");
		await notices.apply("omp:18.8.4", "update");
		expect(notices.list.map(({ id, seen, status }) => [id, seen, status])).toEqual([
			["omp:18.8.4", true, { state: "updated", note: "omp 18.8.4 is installed. Restart omp-agents to load it." }],
			[OPUS_ID, true, { state: "updated", note: "default and smol fallbacks use Claude Opus 5.6 now." }],
		]);

		state.latest = "18.8.5";
		const base = sources(state);
		let attempts = 0;
		const flaky = new Notices(noticesPath(), { ...base, updateOmp: async latest => (++attempts === 1 ? Promise.reject(new Error("Update failed: offline")) : base.updateOmp(latest)) }, () => {});
		await flaky.check();
		await flaky.apply("omp:18.8.5", "update");
		expect(flaky.list[0].status).toEqual({ state: "failed", error: "Update failed: offline" });
		await flaky.apply("omp:18.8.5", "update");
		expect(flaky.list[0].status).toEqual({ state: "updated", note: "omp 18.8.5 is installed. Restart omp-agents to load it." });
	});

	test("a check that fails keeps the notices and marks the last one found", async () => {
		const path = noticesPath();
		const state: { latest: string | null; installed: string; models: ModelUpdate[]; fail?: string } = { latest: "18.8.4", installed: "18.8.0", models: [opus] };
		const first = new Notices(path, sources(state), () => {});
		await first.check();
		await first.apply(OPUS_ID, "seen");

		state.fail = "offline";
		const second = new Notices(path, sources(state), () => {});
		await second.check();
		expect(second.list).toEqual([]);
		await first.check();
		expect(first.list.map(({ id }) => id)).toEqual(["omp:18.8.4", OPUS_ID]);

		state.fail = undefined;
		await second.check();
		expect(second.list.find(({ id }) => id === OPUS_ID)?.seen).toBe(true);
	});
});
