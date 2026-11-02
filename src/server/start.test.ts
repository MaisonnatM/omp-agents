import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DashboardSession } from "../dashboard-session";
import * as commands from "../commands";
import * as git from "../git";
import type { TrustAsk } from "../shared/project-trust";
import { newSessionRequest, type SessionFacts } from "../shared/sessions";
import { TaskClaims } from "../task-claims";
import { claudeCodeRoot } from "../foreign/claude-code";
import { codexHome } from "../foreign/codex";
import { flushJsonFiles } from "../fs";
import * as keeperLink from "../keeper-link";
import { pidFileOf } from "../keeper-wire";
import * as rpc from "../omp/rpc";
import { refuseUntil } from "./http";
import { InterruptedSessions } from "./interrupted";
import { LiveSessions } from "./live-sessions";
import { UntrustedProjectError, untrustedText } from "./project-trust-file";
import { createStarter, reattachAll, type SessionJoin } from "./start";

afterEach(() => mock.restore());

test("a Claude Code or Codex session neither resumes, forks, nor replays, before any omp starts", async () => {
	const claudeFile = join(claudeCodeRoot(), "-work", "c1.jsonl");
	const codexFile = join(codexHome(), "sessions", "2026", "10", "01", "rollout-x1.jsonl");
	const start = createStarter({
		sessions: fromPartial<LiveSessions>({
			sessionIds: () => new Set<string>(),
			allocate: () => {
				throw new Error("no omp should start");
			},
		}),
		pathFor: () => codexFile,
		savedFile: () => claudeFile,
		factsFor: () => { throw new Error("A read-only resume must not inspect omp facts."); },
		onStarted: () => {},
		workspaceOf: async cwd => cwd,
		linkTodo: () => {},
		mayDiscardReplay: async () => null,
		admit: async () => { throw new Error("A read-only start must not take a census."); },
		joinFor: () => ({ rpc: rpc.PLAIN_LAUNCH, attach: () => {} }),
	});
	expect(await start({ kind: "resume", sessionId: "c1" })).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
	expect(await start({ kind: "fork", view: { kind: "past", sessionId: "x1" }, entryId: "e1" })).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
	expect(await start({ kind: "replay", view: { kind: "past", sessionId: "x1" }, token: "t", model: null, thinking: null, prompt: null })).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
});

test("the server learns which sessions survived before it lists or hears any, and lists none that exited as it attached", async () => {
	spyOn(rpc, "keptSessions").mockReturnValue(["i-kept", "i-gone", "i-broken"]);
	spyOn(console, "error").mockImplementation(() => {});
	spyOn(DashboardSession, "reattach").mockImplementation(async (instanceId, _toolsFor, emit) => {
		if (instanceId === "i-broken") throw new Error("omp did not answer");
		// A question omp still waits on reaches the session while it attaches.
		emit({ kind: "roster" });
		const fields = { instanceId: { value: instanceId }, sessionId: { value: `s-${instanceId}` }, finished: { value: () => instanceId === "i-gone" } };
		return fromPartial(Object.create(DashboardSession.prototype, fields));
	});
	const dir = mkdtempSync(join("/tmp", "ost-"));
	try {
		const heard: string[] = [];
		const sessions: LiveSessions = new LiveSessions((instanceId, update) => heard.push(`${update.kind} ${instanceId}, listed: ${sessions.get(instanceId) !== undefined}`), undefined, join(dir, "unread.json"));
		const joinFor = (): SessionJoin => ({ rpc: rpc.PLAIN_LAUNCH, attach: session => { heard.push(`attach ${session.instanceId}`); } });
		await reattachAll(sessions, joinFor, survived => {
			heard.push(`recover ${[...survived].join(" ")}`);
			return new Set();
		});
		expect(heard).toEqual(["recover s-i-kept", "attach i-kept", "roster i-kept, listed: true"]);
		expect([sessions.get("i-gone"), sessions.get("i-broken")]).toEqual([undefined, undefined]);
		// The cleanup after a merge ends only sessions this dashboard started, which a reattached one still is.
		expect(sessions.started("i-kept")?.sessionId).toBe("s-i-kept");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a reattached session whose turn ended while no server listened is listed with that turn unread, and a turn left unread before the restart comes back", async () => {
	const dir = mkdtempSync(join("/tmp", "ost-"));
	try {
		const file = join(dir, "session.jsonl");
		const line = (timestamp: string, role: string, text: string) => `${JSON.stringify({ type: "message", timestamp, message: { role, content: [{ type: "text", text }] } })}\n`;
		writeFileSync(file, `${JSON.stringify({ type: "session", id: "s", cwd: dir })}\n${line("2026-11-02T10:00:00.000Z", "user", "Sleep 12 seconds")}${line("2026-11-02T10:00:12.000Z", "assistant", "done")}`);
		const unreadPath = join(dir, "unread.json");
		new LiveSessions(() => {}, undefined, unreadPath).markUnread("i-saved", { at: 5_000, reply: { body: "Saved reply.", suggestions: [] } });
		flushJsonFiles();

		spyOn(rpc, "keptSessions").mockReturnValue(["i-ended", "i-working", "i-idle", "i-saved"]);
		spyOn(DashboardSession, "reattach").mockImplementation(async instanceId => {
			const fields = {
				instanceId: { value: instanceId },
				sessionId: { value: `s-${instanceId}` },
				sessionFile: { value: file },
				cwd: { value: dir },
				status: { value: instanceId === "i-working" ? "working" : "idle" },
				finished: { value: () => false },
				row: { value: () => ({ instanceId }) },
			};
			return fromPartial(Object.create(DashboardSession.prototype, fields));
		});
		const sessions = new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json")), unreadPath);
		await reattachAll(sessions, () => ({ rpc: rpc.PLAIN_LAUNCH, attach: () => {} }), () => new Set(["s-i-ended", "s-i-working"]));
		const facts: SessionFacts = { tickets: [], pullRequests: [], worktree: null, branch: null, ship: null, workspace: null };
		expect(sessions.rows(() => facts).map(row => [row.instanceId, row.unread])).toEqual([
			["i-ended", { at: Date.parse("2026-11-02T10:00:12.000Z"), reply: "done", body: "done", suggestions: [] }],
			["i-working", null],
			["i-idle", null],
			["i-saved", { at: 5_000, reply: "Saved reply.", body: "Saved reply.", suggestions: [] }],
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A keeper that took the connection and is stuck: it records its pid as a keeper does, runs a job in a session of its
 * own as omp's background jobs do, prints that job's pid, listens, and never greets.
 */
const STUCK_KEEPER = `
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
const [socket, pidFile] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
const job = Bun.spawn(["sleep", "61"], { detached: true, stdout: "ignore" });
createServer(() => {}).listen(socket, () => console.log(job.pid));
`;

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test("a keeper that never greets is stopped with its job within the bound, then the socket opens and its session is interrupted", async () => {
	const dir = mkdtempSync(join("/tmp", "ost-"));
	try {
		const socket = join(dir, "stuck.sock");
		writeFileSync(join(dir, "keeper.ts"), STUCK_KEEPER);
		const keeper = Bun.spawn([process.execPath, join(dir, "keeper.ts"), socket, pidFileOf(socket)], { stdout: "pipe" });
		const job = Number(new TextDecoder().decode((await keeper.stdout.getReader().read()).value));
		expect(alive(job)).toBe(true);
		const attach = keeperLink.attachKeeper;
		spyOn(keeperLink, "attachKeeper").mockImplementation((_dir, instanceId) => attach(dir, instanceId));
		spyOn(rpc, "keptSessions").mockReturnValue(["stuck"]);
		spyOn(console, "error").mockImplementation(() => {});
		const saved = join(dir, "interrupted.json");
		new InterruptedSessions(saved).setRunning(new Map([["s-stuck", true]]));
		flushJsonFiles();
		const interrupted = new InterruptedSessions(saved);

		const began = Date.now();
		const reattached = reattachAll(new LiveSessions(() => {}, undefined, join(dir, "unread.json")), () => ({ rpc: rpc.PLAIN_LAUNCH, attach: () => {} }), survived => interrupted.recover(survived));
		const notReattached = refuseUntil(reattached, "Still attaching.");
		expect(notReattached()?.status).toBe(503);
		await reattached;
		await keeper.exited;
		expect([Date.now() - began < 8_000, notReattached(), interrupted.has("s-stuck"), interrupted.stoppedMidTurn("s-stuck"), alive(job), readdirSync(dir).sort()]).toEqual([
			true,
			null,
			true,
			true,
			false,
			["interrupted.json", "keeper.ts"],
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 15_000);

/** Drives the production launcher and registry without starting an actual omp provider. */
function claimedStarter(
	sessions: LiveSessions,
	savedFile: string | null = null,
	factsFor: () => SessionFacts = () => ({ tickets: [], pullRequests: [], worktree: null, branch: null, ship: null, workspace: null }),
	admit: (cwd: string) => Promise<void> = async () => {},
) {
	return createStarter({
		sessions,
		pathFor: () => null,
		savedFile: () => savedFile,
		factsFor,
		onStarted: () => {},
		workspaceOf: async cwd => cwd,
		linkTodo: () => {},
		mayDiscardReplay: async () => null,
		joinFor: () => ({ rpc: rpc.PLAIN_LAUNCH, attach: () => {} }),
		admit,
	});
}

function sessionForStart(instanceId: string, cwd: string): DashboardSession {
	return Object.setPrototypeOf(fromPartial<DashboardSession>({
		instanceId, cwd, pid: process.pid, sessionId: `s-${instanceId}`,
		finished: () => false,
		prompt: async () => {},
	}), DashboardSession.prototype);
}

test("simultaneous task launches across registries allow one writer before checkout, and ending releases the task", async () => {
	const dir = mkdtempSync("/tmp/omp-start-claim-");
	try {
		const claims = join(dir, "claims.json");
		const firstSessions = new LiveSessions(() => {}, new TaskClaims(claims));
		const secondSessions = new LiveSessions(() => {}, new TaskClaims(claims));
		const first = claimedStarter(firstSessions);
		const second = claimedStarter(secondSessions);
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		const checkout = spyOn(git, "checkoutDir").mockResolvedValue(dir);
		spyOn(commands, "withPinnedSkill").mockImplementation(async (_cwd, _skill, prompt) => prompt);
		const spawn = spyOn(DashboardSession, "start").mockImplementation(async (id, cwd) => sessionForStart(id, cwd));
		const request = newSessionRequest(dir, "Implement the ticket", { subject: { kind: "ticket", id: "ENG-2650" }, branch: { kind: "existing", name: "work" } });
		const results = await Promise.all([first(request), second(request)]);
		expect(results.filter(result => result.ok)).toHaveLength(1);
		expect(results.filter(result => !result.ok)).toHaveLength(1);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(checkout).toHaveBeenCalledTimes(1);
		const result = results.find(result => result.ok);
		if (!result?.ok) throw new Error("One launch must own the task.");
		const registry = firstSessions.get(result.instanceId) ? firstSessions : secondSessions;
		registry.remove(result.instanceId);
		expect((await first(request)).ok).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a failed spawn releases its claim, while distinct explicit tasks may intentionally share a checkout", async () => {
	const dir = mkdtempSync("/tmp/omp-start-claim-");
	try {
		const start = claimedStarter(new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json"))));
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		spyOn(commands, "withPinnedSkill").mockImplementation(async (_cwd, _skill, prompt) => prompt);
		const spawn = spyOn(DashboardSession, "start").mockRejectedValueOnce(new Error("failed to spawn"));
		spawn.mockImplementation(async (id, cwd) => sessionForStart(id, cwd));
		const request = newSessionRequest(dir, "/ship ENG2650");
		expect(await start(request)).toMatchObject({ ok: false, error: expect.stringContaining("failed to spawn") });
		expect((await start(request)).ok).toBe(true);
		expect((await start(newSessionRequest(dir, "/ship ENG2650", { taskId: "ENG-2650:tests-only" }))).ok).toBe(true);
		expect((await start(newSessionRequest(dir, "/ship ENG2650", { taskId: "ENG-2650:server-only" }))).ok).toBe(true);
		expect((await start(newSessionRequest(dir, "Explain the unrelated architecture"))).ok).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a start in a project with untrusted code spawns no omp, asks with the pieces, and releases its claim", async () => {
	const dir = mkdtempSync("/tmp/omp-start-trust-");
	try {
		const ask: TrustAsk = { root: dir, rootDisplay: dir, code: [{ kind: "extension", id: ".omp/extensions/a.ts", name: ".omp/extensions/a.ts", hash: "h1", change: "new" }] };
		let trusted = false;
		const admit = mock(async (_cwd: string) => {
			if (!trusted) throw new UntrustedProjectError(ask);
		});
		const start = claimedStarter(new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json"))), null, undefined, admit);
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		spyOn(commands, "withPinnedSkill").mockImplementation(async (_cwd, _skill, prompt) => prompt);
		const keeper = spyOn(keeperLink, "startKeeper").mockRejectedValue(new Error("no omp should start"));
		const request = newSessionRequest(dir, "/ship ENG2650");
		expect(await start(request)).toEqual({ ok: false, error: untrustedText(ask), trust: ask });
		expect(admit).toHaveBeenCalledWith(dir);
		expect(keeper).not.toHaveBeenCalled();
		trusted = true;
		spyOn(DashboardSession, "start").mockImplementation(async (id, cwd) => sessionForStart(id, cwd));
		expect((await start(request)).ok).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a start whose admission fails spawns no omp and says why", async () => {
	const dir = mkdtempSync("/tmp/omp-start-trust-");
	try {
		const start = claimedStarter(new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json"))), null, undefined, async cwd => { throw new Error(`Cannot check the agent code in ${cwd}: unreadable`); });
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		spyOn(commands, "withPinnedSkill").mockImplementation(async (_cwd, _skill, prompt) => prompt);
		const keeper = spyOn(keeperLink, "startKeeper").mockRejectedValue(new Error("no omp should start"));
		expect(await start(newSessionRequest(dir, "hello"))).toEqual({ ok: false, error: `Cannot start omp: Cannot check the agent code in ${dir}: unreadable` });
		expect(keeper).not.toHaveBeenCalled();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resuming a saved ticket claims the same task and refuses another session's claim before spawning", async () => {
	const dir = mkdtempSync("/tmp/omp-start-resume-");
	try {
		const file = join(dir, "saved.jsonl");
		writeFileSync(file, `${JSON.stringify({ type: "session", cwd: dir })}\n`);
		const sessions = new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json")));
		const start = claimedStarter(sessions, file, () => ({ tickets: ["ENG-2650"], pullRequests: [], worktree: null, branch: null, ship: null, workspace: null }));
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		expect(await sessions.reserveTask("ticket:ENG-2650", "already-working", dir, () => { throw new Error("no running sessions"); })).toBeNull();
		const resume = spyOn(DashboardSession, "resume").mockImplementation(async (id) => sessionForStart(id, dir));
		expect(await start({ kind: "resume", sessionId: "saved" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("ticket:ENG-2650 is already claimed by"),
			owner: { here: true, instanceId: "already-working", sessionName: null, cwdDisplay: dir },
		});
		expect(resume).not.toHaveBeenCalled();
		sessions.releaseTask("already-working");
		expect((await start({ kind: "resume", sessionId: "saved" })).ok).toBe(true);
		expect(resume).toHaveBeenCalledTimes(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a resume whose task lookup fails never starts an unclaimed writer", async () => {
	const dir = mkdtempSync("/tmp/omp-start-resume-");
	try {
		const start = claimedStarter(new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json"))), join(dir, "saved.jsonl"), () => { throw new Error("facts unavailable"); });
		const resume = spyOn(DashboardSession, "resume");
		expect(await start({ kind: "resume", sessionId: "saved" })).toMatchObject({ ok: false, error: expect.stringContaining("facts unavailable") });
		expect(resume).not.toHaveBeenCalled();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a terminal or pre-claim session already in the registry owns its explicit subject too", async () => {
	const dir = mkdtempSync("/tmp/omp-start-existing-");
	try {
		const sessions = new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json")));
		sessions.add(fromPartial({ instanceId: "terminal-owner", sessionId: "s-terminal", cwd: dir, finished: () => false }), { kind: "ticket", id: "ENG-2650" });
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		const spawn = spyOn(DashboardSession, "start");
		const result = await claimedStarter(sessions)(newSessionRequest(dir, "/ship ENG2650"));
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining("#session/s-terminal") });
		expect(spawn).not.toHaveBeenCalled();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an explicit read-only PR review coexists with implementation, but duplicate launches of either role do not", async () => {
	const dir = mkdtempSync("/tmp/omp-start-review-role-");
	try {
		const start = claimedStarter(new LiveSessions(() => {}, new TaskClaims(join(dir, "claims.json"))));
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		spyOn(commands, "withPinnedSkill").mockImplementation(async (_cwd, _skill, prompt) => prompt);
		const spawn = spyOn(DashboardSession, "start").mockImplementation(async (id, cwd) => sessionForStart(id, cwd));
		const subject = { kind: "pull-request" as const, pr: { owner: "acme", repo: "app", number: 7 } };
		const review = newSessionRequest(dir, "Review without modifying the implementation", { subject, reviewDraft: true });
		const implementation = newSessionRequest(dir, "Implement the requested changes", { subject });
		expect((await start(review)).ok).toBe(true);
		expect((await start(implementation)).ok).toBe(true);
		expect(await start(review)).toMatchObject({ ok: false, error: expect.stringContaining("review:pr:acme/app#7") });
		expect(await start(implementation)).toMatchObject({ ok: false, error: expect.stringContaining("pr:acme/app#7") });
		expect(spawn).toHaveBeenCalledTimes(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an explicit independent task survives reattachment and ended-session resume ahead of inferred ticket subjects", async () => {
	const dir = mkdtempSync("/tmp/omp-start-independent-resume-");
	try {
		const path = join(dir, "claims.json");
		const file = join(dir, "saved.jsonl");
		writeFileSync(file, `${JSON.stringify({ type: "session", cwd: dir })}\n`);
		const claims = new TaskClaims(path);
		claims.claim("/repo/.git", "task:ENG-2650:tests-only", "original", dir);
		claims.bind("original", process.pid, "s-original", dir);
		const restarted = new LiveSessions(() => {}, new TaskClaims(path));
		restarted.add(sessionForStart("original", dir), { kind: "ticket", id: "ENG-2650" });
		spyOn(git, "repositoryAt").mockResolvedValue("/repo/.git");
		spyOn(commands, "withPinnedSkill").mockImplementation(async (_cwd, _skill, prompt) => prompt);
		spyOn(DashboardSession, "start").mockImplementation(async (id, cwd) => sessionForStart(id, cwd));
		const afterRestart = claimedStarter(restarted);
		expect((await afterRestart(newSessionRequest(dir, "/ship ENG2650"))).ok).toBe(true);
		expect((await afterRestart(newSessionRequest(dir, "/ship ENG2650", { taskId: "ENG-2650:tests-only" }))).ok).toBe(false);
		restarted.remove("original");
		const resumedRegistry = new LiveSessions(() => {}, new TaskClaims(path));
		const resume = claimedStarter(resumedRegistry, file, () => ({ tickets: ["ENG-2650"], pullRequests: [], worktree: null, branch: null, ship: null, workspace: null }));
		spyOn(DashboardSession, "resume").mockImplementation(async id => sessionForStart(id, dir));
		// The implementation ticket still has its own live claim, but this saved session owns the independent test slice.
		expect((await resume({ kind: "resume", sessionId: "s-original" })).ok).toBe(true);
		expect((await resume(newSessionRequest(dir, "/ship ENG2650", { taskId: "ENG-2650:tests-only" }))).ok).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
