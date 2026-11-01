import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExtension } from "./fake-extension-api";
import shepherdExtension, { FIX_TOOL, type FixParams, MERGE_TOOL, type MergeParams, SHEPHERD_FLAGS } from "./shepherd-extension";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The extension loaded as omp loads it for shepherd `herd`, its flags but those `unset` names. */
function loaded(unset: string[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-shepherd-extension-"));
	dirs.push(dir);
	const inbox = join(dir, "shepherd-inbox");
	const flags = new Map<string, string>([
		[SHEPHERD_FLAGS.bot, "herd"],
		[SHEPHERD_FLAGS.inbox, inbox],
	]);
	for (const name of unset) flags.delete(name);
	const left = () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8"))) : []);
	return { ...loadExtension(shepherdExtension, flags), left };
}

const target = { owner: "acme", repo: "webapp", number: 7 };

test("each tool leaves one request for the dashboard from this shepherd, a merge squashing unless it names a method", async () => {
	const { call, left } = loaded();
	await call<FixParams>(FIX_TOOL, { ...target, action: "resolve-conflicts" });
	await call<MergeParams>(MERGE_TOOL, target);
	await call<MergeParams>(MERGE_TOOL, { ...target, method: "rebase" });
	const requests = left();
	expect(requests).toHaveLength(3);
	expect(requests).toEqual(
		expect.arrayContaining([
			{ botId: "herd", change: { op: "fix", pr: target, action: "resolve-conflicts" } },
			{ botId: "herd", change: { op: "merge", pr: target, method: "squash" } },
			{ botId: "herd", change: { op: "merge", pr: target, method: "rebase" } },
		]),
	);
});

test("a fix that is not a repair, a bad pull request name, or a session that is not a shepherd leaves nothing", async () => {
	const { call, left } = loaded();
	await expect(call<FixParams>(FIX_TOOL, { ...target, action: "review" })).rejects.toThrow("action must be one of");
	await expect(call<FixParams>(FIX_TOOL, { ...target, owner: "..", action: "fix-ci" })).rejects.toThrow("is not a pull request name");
	expect(left()).toEqual([]);
	const plain = loaded([SHEPHERD_FLAGS.bot]);
	await expect(plain.call<MergeParams>(MERGE_TOOL, target)).rejects.toThrow("This session is not an omp-agents PR shepherd.");
	expect(plain.prompt()).toBeUndefined();
});

test("a shepherd's main agent hears what its tools do and what the dashboard refuses", () => {
	const lines = loaded().prompt()!;
	expect(lines[0]).toBe("base");
	expect(lines[1]).toContain(`\`${FIX_TOOL}\` starts one session on a pull request's branch`);
	expect(lines[1]).toContain("queues a merge only when the head has the same diff as a commit a reviewer approved");
});
