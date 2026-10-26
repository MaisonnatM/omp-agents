import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { HOME } from "../paths";
import { readSessionFile } from "../omp/sessions";
import { runChecked } from "../proc";
import type { AgentRow, RosterHost } from "../shared/sessions";
import { Worktrees, type WorktreeOccupant } from "../worktrees";
import type { WorktreeTarget } from "../worktrees-shared";
import { WorktreeOccupants } from "./worktree-occupants";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });
const at = "2026-10-01T12:00:00.000Z";

async function repository(names: string[]): Promise<{ root: string; main: string; targets: WorktreeTarget[] }> {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-occupants-")));
	dirs.push(root);
	const main = join(root, "main");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	const common = realpathSync((await git(main, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
	const targets: WorktreeTarget[] = [];
	for (const name of names) {
		const path = join(root, name);
		await git(main, "worktree", "add", "-q", "-b", name, path);
		targets.push({ repository: common, path });
	}
	return { root, main, targets };
}

function agent(id: string, status: AgentRow["status"] = "running", parentId: string | null = null): AgentRow {
	return { id, kind: "task", parentId, status, activity: null, canMessage: true, queue: { steering: [], followUp: [] } };
}

function terminal(cwd: string, agents: AgentRow[] = [agent("Child")], overrides: Partial<Extract<RosterHost, { source: "terminal" }>> = {}): Extract<RosterHost, { source: "terminal" }> {
	return {
		instanceId: "room", sessionId: "parent", sessionName: "Checkout session", pid: 1, cwd, cwdDisplay: cwd,
		model: null, thinkingLevel: null, context: null, startedAt: 0, status: "idle", control: { phase: "live", readOnly: false },
		agents, requests: [], queue: { steering: [], followUp: [] }, unread: null,
		pullRequests: [], tickets: [], ship: null, worktree: null, branch: null,
		source: "terminal", participants: 0, relayConnected: true, ...overrides,
	};
}

function bash(cwd: string, id = "call"): object {
	return {
		type: "message", id, parentId: "prompt", timestamp: at,
		message: {
			role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "claude", timestamp: 2, stopReason: "toolUse",
			content: [{ type: "toolCall", id: `${id}-tool`, name: "bash", arguments: { command: "pwd", cwd } }],
		},
	};
}

function native(path: string, cwd: string, workDirs: string[] = []): string {
	const entries = [
		{ type: "session", version: 3, id: "native-child", timestamp: at, cwd },
		{ type: "message", id: "prompt", parentId: null, timestamp: at, message: { role: "user", content: "Inspect checkout safety", timestamp: 1 } },
		...workDirs.map((dir, i) => bash(dir, `call-${i}`)),
	];
	writeFileSync(path, entries.map(entry => `${JSON.stringify(entry)}\n`).join(""));
	return path;
}

function worktrees(occupants: WorktreeOccupant[]): Worktrees {
	return new Worktrees({
		knownCwds: () => [], activity: () => [], live: () => occupants,
		serverCwd: "/no/such/occupancy-dashboard", mergedPullRequests: async () => new Map(),
	});
}

async function codes(occupants: WorktreeOccupant[], target: WorktreeTarget): Promise<string[]> {
	return (await worktrees(occupants).preview(target)).blockers.map(blocker => blocker.code);
}

describe("resident checkout protection", () => {
	test("protects the default and every declared cwd, including relative, home, nested and cross-repository paths, but releases siblings", async () => {
		const { root, main, targets: [defaulted, first, second, assigned, unused] } = await repository(["default", "first", "second", "assigned", "unused"]);
		const { targets: [foreign, foreignUnused] } = await repository(["foreign", "unused"]);
		if (!defaulted || !first || !second || !assigned || !unused || !foreign || !foreignUnused) throw new Error("Missing fixture worktree");
		mkdirSync(join(second.path, "src"));
		mkdirSync(join(foreign.path, "front"));
		const path = native(join(root, "child.jsonl"), defaulted.path, [relative(defaulted.path, first.path), `~/${relative(HOME, join(second.path, "src"))}`, join(foreign.path, "front")]);
		const occupants = await new WorktreeOccupants().snapshot([terminal(main, [agent("Child")], { worktree: assigned.path })], () => path);
		for (const target of [defaulted, first, second, assigned, foreign]) expect(await codes(occupants, target)).toEqual(["occupied"]);
		expect(await codes(occupants, unused)).toEqual([]);
		expect(await codes(occupants, foreignUnused)).toEqual([]);
		expect((await worktrees(occupants).inUse()).sort()).toEqual([main, assigned.path, defaulted.path, first.path, join(second.path, "src"), join(foreign.path, "front"), "/no/such/occupancy-dashboard"].sort());
		const plan = await worktrees(occupants).preview(foreign);
		expect(plan.blockers[0]?.message).toContain("parent");
		expect(plan.blockers[0]?.message).toContain("Child");
	});

	test("keeps the parent scope for a missing transcript and releases it when a native child file appears", async () => {
		const { root, main, targets: [used, unused] } = await repository(["used", "unused"]);
		if (!used || !unused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = join(root, "later.jsonl");
		const missing = await collector.snapshot(hosts, () => path);
		expect(await codes(missing, unused)).toEqual(["unknown-agent-location"]);
		const plan = await worktrees(missing).preview(unused);
		expect(plan.blockers[0]?.message).toContain("parent");
		expect(plan.blockers[0]?.message).toContain("Child");
		native(path, used.path);
		const appeared = await collector.snapshot(hosts, () => path);
		expect(await codes(appeared, used)).toEqual(["occupied"]);
		expect(await codes(appeared, unused)).toEqual([]);
	});

	test("fails closed on null, relative, unreadable, malformed and relative-header transcript candidates", async () => {
		const { root, main, targets: [unused] } = await repository(["unused"]);
		if (!unused) throw new Error("Missing fixture worktree");
		const directory = join(root, "directory.jsonl");
		mkdirSync(directory);
		const malformed = join(root, "malformed.jsonl");
		writeFileSync(malformed, '{"type":"session","cwd":\n');
		const relativeHeader = native(join(root, "relative.jsonl"), "../some-checkout");
		const noHeader = join(root, "no-header.jsonl");
		writeFileSync(noHeader, `${JSON.stringify(bash(main))}\n`);
		for (const path of [null, "relative-transcript.jsonl", directory, malformed, relativeHeader, noHeader]) {
			const occupants = await new WorktreeOccupants().snapshot([terminal(main)], () => path);
			expect(await codes(occupants, unused)).toEqual(["unknown-agent-location"]);
		}
		const valid = native(join(root, "valid.jsonl"), unused.path);
		expect(await codes(await new WorktreeOccupants().snapshot([terminal(main)], () => valid), unused)).toEqual(["occupied"]);
	});

	test("retries a bad header and retains absolute Bash evidence even before the default is known", async () => {
		const { root, main, targets: [used, unused] } = await repository(["used", "unused"]);
		if (!used || !unused) throw new Error("Missing fixture worktree");
		const path = join(root, "child.jsonl");
		writeFileSync(path, `not a native header\n${JSON.stringify(bash(used.path))}\n`);
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const invalid = await collector.snapshot(hosts, () => path);
		expect(await codes(invalid, used)).toEqual(["occupied", "unknown-agent-location"]);
		expect(await codes(invalid, unused)).toEqual(["unknown-agent-location"]);
		native(path, used.path);
		await collector.snapshot(hosts, () => path);
		const recovered = await collector.snapshot(hosts, () => path);
		expect(await codes(recovered, used)).toEqual(["occupied"]);
		expect(await codes(recovered, unused)).toEqual([]);
	});

	test("keeps terminal idle and parked children resident, excludes aborted children, and does not prune running descendants", async () => {
		const { root, main, targets: [idle, parked, aborted, descendant, unused] } = await repository(["idle", "parked", "aborted", "descendant", "unused"]);
		if (!idle || !parked || !aborted || !descendant || !unused) throw new Error("Missing fixture worktree");
		const paths: Record<string, string> = {
			Idle: native(join(root, "idle.jsonl"), idle.path),
			Parked: native(join(root, "parked.jsonl"), parked.path),
			Aborted: native(join(root, "aborted.jsonl"), aborted.path),
			Descendant: native(join(root, "descendant.jsonl"), descendant.path),
		};
		const agents = [agent("Idle", "idle"), agent("Parked", "parked"), agent("Aborted", "aborted"), agent("Descendant", "running", "Aborted")];
		const occupants = await new WorktreeOccupants().snapshot([terminal(main, agents)], (_host, id) => paths[id] ?? null);
		for (const target of [idle, parked, descendant]) expect(await codes(occupants, target)).toEqual(["occupied"]);
		expect(await codes(occupants, aborted)).toEqual([]);
		expect(await codes(occupants, unused)).toEqual([]);
	});

	test("releases completed dashboard children but protects a running descendant of a completed parent", async () => {
		const { root, main, targets: [completed, descendant, unused] } = await repository(["completed", "descendant", "unused"]);
		if (!completed || !descendant || !unused) throw new Error("Missing fixture worktree");
		const done = native(join(root, "completed.jsonl"), completed.path);
		const running = native(join(root, "running.jsonl"), descendant.path);
		const host: RosterHost = { ...terminal(main, [agent("Completed", "parked"), agent("Idle", "idle"), agent("Aborted", "aborted"), agent("Descendant", "running", "Completed")]), source: "dashboard", thinkingLevels: [], switching: false, fast: null };
		const occupants = await new WorktreeOccupants().snapshot([host], (_host, id) => id === "Descendant" ? running : done);
		expect(await codes(occupants, descendant)).toEqual(["occupied"]);
		expect(await codes(occupants, completed)).toEqual([]);
		expect(await codes(occupants, unused)).toEqual([]);
	});

	test("keeps a disconnected roster scoped to both parent cwd and additive worktree even with no declared children", async () => {
		const { main, targets: [unused] } = await repository(["unused"]);
		const { targets: [assigned, assignedSibling] } = await repository(["assigned", "sibling"]);
		if (!unused || !assigned || !assignedSibling) throw new Error("Missing fixture worktree");
		const host = terminal(main, [], { worktree: assigned.path, control: { phase: "reconnecting", reason: "transport unavailable" }, relayConnected: false });
		const occupants = await new WorktreeOccupants().snapshot([host], () => null);
		expect(await codes(occupants, unused)).toEqual(["unknown-agent-location"]);
		expect(await codes(occupants, assigned)).toEqual(["occupied", "unknown-agent-location"]);
		expect(await codes(occupants, assignedSibling)).toEqual(["unknown-agent-location"]);
		const live = await new WorktreeOccupants().snapshot([{ ...host, control: { phase: "live", readOnly: false } }], () => null);
		expect(await codes(live, unused)).toEqual([]);
		expect(await codes(live, assigned)).toEqual(["occupied"]);
	});

	test("does not discharge a partial tail and incrementally admits its declared cwd once complete", async () => {
		const { root, main, targets: [defaulted, declared, unused] } = await repository(["default", "declared", "unused"]);
		if (!defaulted || !declared || !unused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = native(join(root, "child.jsonl"), defaulted.path);
		const initial = await collector.snapshot(hosts, () => path);
		expect(await codes(initial, defaulted)).toEqual(["occupied"]);
		expect(await codes(initial, unused)).toEqual([]);
		appendFileSync(path, JSON.stringify(bash(declared.path)));
		const partial = await collector.snapshot(hosts, () => path);
		expect(await codes(partial, defaulted)).toEqual(["occupied", "unknown-agent-location"]);
		expect(await codes(partial, unused)).toEqual(["unknown-agent-location"]);
		appendFileSync(path, "\n");
		const completed = await collector.snapshot(hosts, () => path);
		expect(await codes(completed, defaulted)).toEqual(["occupied"]);
		expect(await codes(completed, declared)).toEqual(["occupied"]);
		expect(await codes(completed, unused)).toEqual([]);
	});

	test("keeps corrupt candidate lines unresolved until a complete replacement recovers", async () => {
		const { root, main, targets: [used, unused] } = await repository(["used", "unused"]);
		if (!used || !unused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = native(join(root, "child.jsonl"), used.path);
		await collector.snapshot(hosts, () => path);
		appendFileSync(path, '{"type":"message","cwd":\n');
		for (let i = 0; i < 2; i++) {
			const corrupt = await collector.snapshot(hosts, () => path);
			expect(await codes(corrupt, used)).toEqual(["occupied", "unknown-agent-location"]);
			expect(await codes(corrupt, unused)).toEqual(["unknown-agent-location"]);
		}
		native(path, used.path);
		const recovered = await collector.snapshot(hosts, () => path);
		expect(await codes(recovered, used)).toEqual(["occupied"]);
		expect(await codes(recovered, unused)).toEqual([]);
	});

	test("retains earlier positive paths and scopes all known repositories after truncation or lost resolution", async () => {
		const { root, main, targets: [used, unused] } = await repository(["used", "unused"]);
		const { targets: [foreign, foreignUnused] } = await repository(["foreign", "unused"]);
		if (!used || !unused || !foreign || !foreignUnused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = native(join(root, "child.jsonl"), used.path, [foreign.path]);
		await collector.snapshot(hosts, () => path);
		writeFileSync(path, "");
		for (const candidate of [path, null]) {
			const missing = await collector.snapshot(hosts, () => candidate);
			for (const target of [used, foreign]) expect(await codes(missing, target)).toEqual(["occupied", "unknown-agent-location"]);
			for (const target of [unused, foreignUnused]) expect(await codes(missing, target)).toEqual(["unknown-agent-location"]);
		}
		native(path, used.path);
		const recovered = await collector.snapshot(hosts, () => path);
		expect(await codes(recovered, used)).toEqual(["occupied"]);
		expect(await codes(recovered, foreign)).toEqual(["occupied"]);
		expect(await codes(recovered, unused)).toEqual([]);
		expect(await codes(recovered, foreignUnused)).toEqual([]);
	});

	test("rereads same-size rewrites and inode replacements without losing earlier positive paths", async () => {
		const { root, main, targets: [alpha, bravo, delta, unused] } = await repository(["alpha", "bravo", "delta", "unused"]);
		if (!alpha || !bravo || !delta || !unused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = native(join(root, "child.jsonl"), alpha.path);
		const size = statSync(path).size;
		await collector.snapshot(hosts, () => path);
		native(path, bravo.path);
		expect(statSync(path).size).toBe(size);
		const rewritten = await collector.snapshot(hosts, () => path);
		expect(await codes(rewritten, alpha)).toEqual(["occupied"]);
		expect(await codes(rewritten, bravo)).toEqual(["occupied"]);
		expect(await codes(rewritten, unused)).toEqual([]);
		const replacement = native(join(root, "replacement.jsonl"), delta.path);
		renameSync(replacement, path);
		const replaced = await collector.snapshot(hosts, () => path);
		for (const target of [alpha, bravo, delta]) expect(await codes(replaced, target)).toEqual(["occupied"]);
		expect(await codes(replaced, unused)).toEqual([]);
	});

	test("forgets evidence only when its child ceases to be resident", async () => {
		const { root, main, targets: [former, current] } = await repository(["former", "current"]);
		if (!former || !current) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const host = terminal(main);
		const path = native(join(root, "child.jsonl"), former.path);
		expect(await codes(await collector.snapshot([host], () => path), former)).toEqual(["occupied"]);
		const ended = await collector.snapshot([{ ...host, agents: [agent("Child", "aborted")] }], () => path);
		expect(await codes(ended, former)).toEqual([]);
		native(path, current.path);
		const resumed = await collector.snapshot([host], () => path);
		expect(await codes(resumed, current)).toEqual(["occupied"]);
		expect(await codes(resumed, former)).toEqual([]);
	});

	test("retains missing roster children across reconnects, then releases them on an authoritative live roster or parent departure", async () => {
		const { root, main, targets: [localUnused] } = await repository(["unused"]);
		const { targets: [foreign, foreignUnused] } = await repository(["foreign", "unused"]);
		if (!localUnused || !foreign || !foreignUnused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const host = terminal(main);
		const path = native(join(root, "child.jsonl"), foreign.path);
		expect(await codes(await collector.snapshot([host], () => path), foreign)).toEqual(["occupied"]);
		const disconnected = { ...host, agents: [], control: { phase: "reconnecting", reason: "lost roster" } } satisfies RosterHost;
		const retained = await collector.snapshot([disconnected], () => null);
		expect(await codes(retained, foreign)).toEqual(["occupied", "unknown-agent-location"]);
		expect(await codes(retained, foreignUnused)).toEqual(["unknown-agent-location"]);
		expect(await codes(retained, localUnused)).toEqual(["unknown-agent-location", "unknown-agent-location"]);
		expect((await worktrees(retained).preview(foreignUnused)).blockers[0]?.message).toContain("Child");
		const live = await collector.snapshot([{ ...host, agents: [] }], () => null);
		expect(await codes(live, foreign)).toEqual([]);
		expect(await codes(live, foreignUnused)).toEqual([]);
		expect(await codes(await collector.snapshot([host], () => path), foreign)).toEqual(["occupied"]);
		await collector.snapshot([disconnected], () => null);
		const gone = await collector.snapshot([], () => null);
		expect(await codes(gone, foreign)).toEqual([]);
		expect(await codes(gone, localUnused)).toEqual([]);
	});

	test("preserves known cross-repository evidence while a previously readable transcript disappears", async () => {
		const { root, main, targets: [unused] } = await repository(["unused"]);
		const { targets: [foreign, foreignUnused] } = await repository(["foreign", "unused"]);
		if (!unused || !foreign || !foreignUnused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = native(join(root, "child.jsonl"), foreign.path);
		await collector.snapshot(hosts, () => path);
		const moved = join(root, "moved.jsonl");
		renameSync(path, moved);
		const missing = await collector.snapshot(hosts, () => path);
		expect(await codes(missing, foreign)).toEqual(["occupied", "unknown-agent-location"]);
		expect(await codes(missing, foreignUnused)).toEqual(["unknown-agent-location"]);
		expect(await codes(missing, unused)).toEqual(["unknown-agent-location"]);
		renameSync(moved, path);
		const recovered = await collector.snapshot(hosts, () => path);
		expect(await codes(recovered, foreign)).toEqual(["occupied"]);
		expect(await codes(recovered, foreignUnused)).toEqual([]);
		expect(await codes(recovered, unused)).toEqual([]);
	});
});

describe("resident evidence transitions", () => {
	test("keeps a surviving child's cross-repository evidence when its parent switches sessions", async () => {
		const { root, main, targets: [localUnused] } = await repository(["unused"]);
		const { targets: [foreign, foreignUnused] } = await repository(["foreign", "unused"]);
		if (!localUnused || !foreign || !foreignUnused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const host = terminal(main);
		const path = native(join(root, "surviving.jsonl"), foreign.path);
		expect(await codes(await collector.snapshot([host], () => path), foreign)).toEqual(["occupied"]);
		const switched = { ...host, sessionId: "continued-parent", sessionName: "Continued session" };
		const unresolved = await collector.snapshot([switched], () => null);
		expect(await codes(unresolved, foreign)).toEqual(["occupied", "unknown-agent-location"]);
		expect(await codes(unresolved, foreignUnused)).toEqual(["unknown-agent-location"]);
		expect(await codes(unresolved, localUnused)).toEqual(["unknown-agent-location"]);
		expect((await worktrees(unresolved).preview(foreign)).blockers[0]?.message).toContain("continued-parent");
		const resolved = await collector.snapshot([switched], () => path);
		expect(await codes(resolved, foreign)).toEqual(["occupied"]);
		expect(await codes(resolved, foreignUnused)).toEqual([]);
		const ended = await collector.snapshot([{ ...switched, agents: [] }], () => null);
		expect(await codes(ended, foreign)).toEqual([]);
	});

	test("rereads growing in-place rewrites of the header and earlier working-directory records", async () => {
		const { root, main, targets: [alpha, bravo, delta, extra, unused] } = await repository(["alpha", "bravo", "delta", "extra", "unused"]);
		if (!alpha || !bravo || !delta || !extra || !unused) throw new Error("Missing fixture worktree");
		for (const rewriteHeader of [true, false]) {
			const collector = new WorktreeOccupants();
			const hosts = [terminal(main)];
			const path = native(join(root, `growing-${rewriteHeader}.jsonl`), alpha.path, [bravo.path]);
			const before = statSync(path);
			await collector.snapshot(hosts, () => path);
			native(path, rewriteHeader ? delta.path : alpha.path, [rewriteHeader ? bravo.path : delta.path, extra.path]);
			expect(statSync(path).ino).toBe(before.ino);
			expect(statSync(path).size > before.size).toBe(true);
			const rewritten = await collector.snapshot(hosts, () => path);
			for (const target of [alpha, bravo, delta, extra]) expect(await codes(rewritten, target)).toEqual(["occupied"]);
			expect(await codes(rewritten, unused)).toEqual([]);
		}
	});

	test("reads the current native header after an mtime-preserving replacement", async () => {
		const { root, main, targets: [alpha, bravo, unused] } = await repository(["alpha", "bravo", "unused"]);
		if (!alpha || !bravo || !unused) throw new Error("Missing fixture worktree");
		const collector = new WorktreeOccupants();
		const hosts = [terminal(main)];
		const path = native(join(root, "preserved.jsonl"), alpha.path);
		utimesSync(path, 100, 100);
		await readSessionFile(path);
		expect(await codes(await collector.snapshot(hosts, () => path), alpha)).toEqual(["occupied"]);
		const before = statSync(path);
		const replacement = native(join(root, "replacement.jsonl"), bravo.path);
		utimesSync(replacement, 100, 100);
		renameSync(replacement, path);
		expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
		expect(statSync(path).size).toBe(before.size);
		const replaced = await collector.snapshot(hosts, () => path);
		expect(await codes(replaced, alpha)).toEqual(["occupied"]);
		expect(await codes(replaced, bravo)).toEqual(["occupied"]);
		expect(await codes(replaced, unused)).toEqual([]);
	});
});
