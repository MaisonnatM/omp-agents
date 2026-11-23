import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";
import { CONFIG_DIR } from "./agent/extensions/inbox/client";

interface Note {
	customType: string;
	content: string;
	display: boolean;
}
type Hook = (event: { systemPrompt: string[] }, ctx: { sessionManager: { getSessionId(): string } }) => { message?: Note; systemPrompt?: string[] } | undefined;

// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const { default: todos }: { default(pi: object): void } = await import(join(import.meta.dir, "agent/extensions/todos.ts"));
const zod: unknown = await import(createRequire(join(packageDir, "package.json")).resolve("@oh-my-pi/omptype/zod"));

/** Writes the dashboard's todo list in the test's config directory, which `src/test-env.ts` points at a scratch folder. */
function writeList(todosList: object[]): void {
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(join(CONFIG_DIR, "todos.json"), JSON.stringify({ todos: todosList }));
}

function session(id: string) {
	const hooks = new Map<string, (...args: unknown[]) => unknown>();
	todos({ zod, on: (name: string, handler: (...args: unknown[]) => unknown) => hooks.set(name, handler), registerTool() {} });
	const ctx = { sessionManager: { getSessionId: () => id } };
	return {
		prompt: () => (hooks.get("before_agent_start") as Hook)({ systemPrompt: ["base"] }, ctx),
		compact: () => hooks.get("session_compact")?.({}, ctx),
	};
}

describe("todos note", () => {
	test("rides in the conversation once per change and leaves the system prompt alone", () => {
		writeList([{ id: "t1", text: "Ship the release", links: [{ kind: "session", sessionId: "s1" }] }]);
		const s1 = session("s1");
		const first = s1.prompt();
		expect(first?.systemPrompt).toBeUndefined();
		expect(first?.message).toMatchObject({ customType: "omp-agents.todos", display: false });
		expect(first?.message?.content).toContain('"Ship the release" (id t1)');
		expect(s1.prompt()).toBeUndefined();

		writeList([
			{ id: "t1", text: "Ship the release", links: [{ kind: "session", sessionId: "s1" }] },
			{ id: "t2", text: "Approve the deploy", addedBy: "s1" },
		]);
		expect(s1.prompt()?.message?.content).toContain("- Approve the deploy (id t2)");
		expect(s1.prompt()).toBeUndefined();
	});

	test("says once that nothing is open any more, then stays quiet", () => {
		writeList([{ id: "t3", text: "Rotate the key", addedBy: "s2" }]);
		const s2 = session("s2");
		expect(s2.prompt()?.message?.content).toContain("Rotate the key");
		writeList([{ id: "t3", text: "Rotate the key", addedBy: "s2", doneAt: "2026-11-23T10:00:00Z" }]);
		expect(s2.prompt()?.message?.content).toBe("No open todo links to this session or was added by it any more.");
		expect(s2.prompt()).toBeUndefined();
	});

	test("sends nothing to a session with no todo, and the note again after a compaction", () => {
		writeList([{ id: "t4", text: "Renew the domain", addedBy: "s3" }]);
		expect(session("other").prompt()).toBeUndefined();
		const s3 = session("s3");
		expect(s3.prompt()?.message).toBeDefined();
		s3.compact();
		expect(s3.prompt()?.message?.content).toContain("Renew the domain");
	});
});
