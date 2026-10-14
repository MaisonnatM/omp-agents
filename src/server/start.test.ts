import { expect, test } from "bun:test";
import { join } from "node:path";
import { claudeCodeRoot } from "../foreign/claude-code";
import { codexHome } from "../foreign/codex";
import type { LiveSessions } from "./live-sessions";
import type { ProjectJoin } from "./project-runner";
import { createStarter } from "./start";

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
