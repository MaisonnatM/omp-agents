import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DashboardSession } from "../dashboard-session";
import { claudeCodeRoot } from "../foreign/claude-code";
import { codexHome } from "../foreign/codex";
import { flushJsonFiles } from "../fs";
import * as keeperLink from "../keeper-link";
import { pidFileOf } from "../keeper-wire";
import * as rpc from "../omp/rpc";
import { refuseUntil } from "./http";
import { InterruptedSessions } from "./interrupted";
import { LiveSessions } from "./live-sessions";
import type { ProjectJoin } from "./project-runner";
import { createStarter, reattachAll } from "./start";

afterEach(() => mock.restore());

test("a Claude Code or Codex session neither resumes, forks, nor replays, before any omp starts", async () => {
	const claudeFile = join(claudeCodeRoot(), "-work", "c1.jsonl");
	const codexFile = join(codexHome(), "sessions", "2026", "10", "01", "rollout-x1.jsonl");
	const start = createStarter({
		sessions: new LiveSessions(() => {}),
		pathFor: () => codexFile,
		savedFile: () => claudeFile,
		onStarted: () => {},
		linkTodo: () => {},
		mayDiscardReplay: async () => null,
		projects: { launchFor: async () => ({ rpc: rpc.PLAIN_LAUNCH, attach: () => {} }) },
	});
	expect(await start({ kind: "resume", sessionId: "c1" }, null)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
	expect(await start({ kind: "fork", view: { kind: "past", sessionId: "x1" }, entryId: "e1" }, null)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
	expect(await start({ kind: "replay", view: { kind: "past", sessionId: "x1" }, token: "t", model: null, thinking: null, prompt: null }, null)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
});

test("the server learns which sessions survived before it lists or hears any, and lists none that exited as it attached", async () => {
	spyOn(rpc, "keptSessions").mockReturnValue(["i-kept", "i-gone", "i-broken"]);
	spyOn(console, "error").mockImplementation(() => {});
	spyOn(DashboardSession, "reattach").mockImplementation(async (instanceId, toolsFor, emit) => {
		if (instanceId === "i-broken") throw new Error("omp did not answer");
		await toolsFor(`s-${instanceId}`);
		// A question omp still waits on reaches the session while it attaches.
		emit({ kind: "roster" });
		const fields = { instanceId: { value: instanceId }, sessionId: { value: `s-${instanceId}` }, finished: { value: () => instanceId === "i-gone" } };
		return fromPartial(Object.create(DashboardSession.prototype, fields));
	});
	const heard: string[] = [];
	const sessions: LiveSessions = new LiveSessions((instanceId, update) => heard.push(`${update.kind} ${instanceId}, listed: ${sessions.get(instanceId) !== undefined}`));
	const projects = { launchFor: async (): Promise<ProjectJoin> => ({ rpc: rpc.PLAIN_LAUNCH, attach: session => { heard.push(`project ${session.instanceId}`); } }) };
	await reattachAll(sessions, projects, survived => heard.push(`recover ${[...survived].join(" ")}`));
	expect(heard).toEqual(["recover s-i-kept", "project i-kept", "roster i-kept, listed: true"]);
	expect([sessions.get("i-gone"), sessions.get("i-broken")]).toEqual([undefined, undefined]);
	// The cleanup after a merge ends only sessions this dashboard started, which a reattached one still is.
	expect(sessions.started("i-kept")?.sessionId).toBe("s-i-kept");
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
		const reattached = reattachAll(new LiveSessions(() => {}), { launchFor: async () => ({ rpc: rpc.PLAIN_LAUNCH, attach: () => {} }) }, survived => interrupted.recover(survived));
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
