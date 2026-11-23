import { afterAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../../src/omp/install";

// The system prompt is the head of every request, cached across sessions only while its bytes stay the same.
// Each extension that hooks `before_agent_start` runs here for two sessions that differ in id, date, prompt, and todos;
// the system prompt they hand back must be the same bytes both times, and what differs must come as a message instead.

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "stable-prefix-")));
afterAll(() => {
	setSystemTime();
	rmSync(scratch, { recursive: true, force: true });
});
// The extensions read their config directory when they load, so it is set before they are imported below. Another
// test file in the same run may have loaded the inbox client first, so the todos go wherever it settled.
process.env.XDG_CONFIG_HOME = join(scratch, "config");
const { CONFIG_DIR: config } = await import("./agent/extensions/inbox/client");
mkdirSync(config, { recursive: true });
writeFileSync(
	join(config, "todos.json"),
	JSON.stringify({
		todos: [
			{ id: "t1", text: "Ship the release", due: "2026-11-30", links: [{ kind: "session", sessionId: "alpha" }] },
			{ id: "t2", text: "Rotate the API key", addedBy: "beta" },
		],
	}),
);

type Result = { systemPrompt?: string[]; message?: { content: string } } | undefined;
type Hook = (event: object, ctx: object) => Result | Promise<Result>;

const extensions = join(import.meta.dir, "agent/extensions");
// The zod omp hands extensions as `pi.zod`, so each tool's schema is built as omp builds it.
const zod: unknown = await import(createRequire(join(packageDir, "package.json")).resolve("@oh-my-pi/omptype/zod"));
const hooked = readdirSync(extensions)
	.filter(name => name.endsWith(".ts") && readFileSync(join(extensions, name), "utf8").includes('"before_agent_start"'))
	.sort();
const hooks: [string, Hook][] = [];
for (const name of hooked) {
	// Imported by path: the list is whatever extensions hook a prompt today, and a static import pulls an extension into
	// `tsc`, where its omp import does not resolve.
	const { default: extension }: { default(pi: object): void } = await import(join(extensions, name));
	const on = (event: string, handler: Hook) => event === "before_agent_start" && hooks.push([name, handler]);
	extension(new Proxy({}, { get: (_target, key) => (key === "zod" ? zod : key === "on" ? on : () => undefined) }));
}

const head = [readFileSync(join(import.meta.dir, "agent/APPEND_SYSTEM.md"), "utf8"), readFileSync(join(import.meta.dir, "agent/AGENTS.md"), "utf8")];

/** The system prompt and the messages every hook leaves for one prompt of session `sessionId` on `day`, threaded as omp threads them. */
async function render(sessionId: string, day: string, prompt: string) {
	setSystemTime(new Date(`${day}T09:00:00Z`));
	const ctx = { cwd: scratch, mode: "interactive", agent: { kind: "main", name: "main" }, sessionManager: { getSessionId: () => sessionId, getBranch: () => [] } };
	let systemPrompt = [...head];
	const messages: string[] = [];
	for (const [, hook] of hooks) {
		const result = await hook({ type: "before_agent_start", reason: "prompt", prompt, systemPrompt }, ctx);
		if (result?.systemPrompt) systemPrompt = result.systemPrompt;
		if (result?.message) messages.push(result.message.content);
	}
	return { systemPrompt: systemPrompt.join("\n"), messages: messages.join("\n") };
}

test("every extension that hooks a prompt is rendered", () => {
	expect(hooked).toEqual(["project-memory.ts", "project.ts", "todos.ts", "untrusted-reader.ts"]);
	expect([...new Set(hooks.map(([name]) => name))]).toEqual(hooked);
});

test("the system prompt is byte-identical across sessions, and what differs comes as a message", async () => {
	const alpha = await render("alpha", "2026-11-23", "Fix the login bug");
	const beta = await render("beta", "2026-12-01", "Write the release notes");
	expect(alpha.systemPrompt).toBe(beta.systemPrompt);
	expect(alpha.systemPrompt).toBe(head.join("\n"));
	expect(alpha.messages).toContain("Ship the release");
	expect(beta.messages).toContain("Rotate the API key");
	// An unchanged note is not sent again, so each prompt appends nothing the conversation already holds.
	expect((await render("beta", "2026-12-01", "Also the README")).messages).toBe("");
});
