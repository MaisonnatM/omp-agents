import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { join } from "node:path";
import { DashboardSession } from "../dashboard-session";
import { claudeCodeRoot } from "../foreign/claude-code";
import { codexHome } from "../foreign/codex";
import * as rpc from "../omp/rpc";
import { LiveSessions } from "./live-sessions";
import type { ProjectJoin } from "./project-runner";
import { createStarter, reattachAll } from "./start";

afterEach(() => mock.restore());

test("a Claude Code or Codex session neither resumes, forks, nor replays, before any omp starts", async () => {
	const claudeFile = join(claudeCodeRoot(), "-work", "c1.jsonl");
	const codexFile = join(codexHome(), "sessions", "2026", "10", "01", "rollout-x1.jsonl");
	const start = createStarter({
		sessions: {
			sessionIds: () => new Set<string>(),
			allocate: () => {
				throw new Error("no omp should start");
			},
		} as unknown as LiveSessions,
		pathFor: () => codexFile,
		savedFile: () => claudeFile,
		onStarted: () => {},
		linkTodo: () => {},
		mayDiscardReplay: async () => null,
		projects: { launchFor: () => ({ rpc: {}, attach: () => {} }) as unknown as ProjectJoin },
	});
	expect(await start({ kind: "resume", sessionId: "c1" }, null)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
	expect(await start({ kind: "fork", view: { kind: "past", sessionId: "x1" }, entryId: "e1" }, null)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
	expect(await start({ kind: "replay", view: { kind: "past", sessionId: "x1" }, token: "t", model: null, thinking: null, prompt: null }, null)).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
});

test("the server learns which sessions survived before it lists or hears any, and lists none that exited as it attached", async () => {
	spyOn(rpc, "keptSessions").mockReturnValue(["i-kept", "i-gone", "i-broken"]);
	spyOn(console, "error").mockImplementation(() => {});
	spyOn(DashboardSession, "reattach").mockImplementation(async (instanceId, _toolsFor, emit) => {
		if (instanceId === "i-broken") throw new Error("omp did not answer");
		// A question omp still waits on reaches the session while it attaches.
		emit({ kind: "roster" });
		return { instanceId, sessionId: `s-${instanceId}`, finished: () => instanceId === "i-gone" } as unknown as DashboardSession;
	});
	const heard: string[] = [];
	const sessions: LiveSessions = new LiveSessions((instanceId, update) => heard.push(`${update.kind} ${instanceId}, listed: ${sessions.get(instanceId) !== undefined}`));
	const projects = { launchFor: () => ({ rpc: { tools: [] }, attach: (session: DashboardSession) => heard.push(`project ${session.instanceId}`) }) as unknown as ProjectJoin };
	await reattachAll(sessions, projects, survived => heard.push(`recover ${[...survived].join(" ")}`));
	expect(heard).toEqual(["recover s-i-kept", "project i-kept", "roster i-kept, listed: true"]);
	expect([sessions.get("i-gone"), sessions.get("i-broken")]).toEqual([undefined, undefined]);
});
