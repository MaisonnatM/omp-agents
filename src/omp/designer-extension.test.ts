import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREATE_TOOL } from "../shared/bot-designer";
import { BOT_FLAGS } from "./bot-extension";
import designerExtension, { type CreateBotParams } from "./designer-extension";
import { loadExtension } from "./fake-extension-api";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The extension loaded as omp loads it for designer `eggbot` in its workspace `lab`, its flags but those `unset` names. */
function loaded(unset: string[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-designer-extension-"));
	dirs.push(dir);
	const lab = join(dir, "lab");
	mkdirSync(lab);
	const inbox = join(dir, "bot-inbox");
	const flags = new Map<string, string>([
		[BOT_FLAGS.bot, "eggbot"],
		[BOT_FLAGS.botInbox, inbox],
	]);
	for (const name of unset) flags.delete(name);
	const { prompt, call } = loadExtension(designerExtension, flags, lab);
	const create = (params: CreateBotParams) => call(CREATE_TOOL, params);
	const left = () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8"))) : []);
	return { dir, lab, prompt, create, left };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("create_bot leaves one create request per call with a fresh id, its fields trimmed, a routines Bot in the designer's workspace unless it names others", async () => {
	const { dir, lab, create, left } = loaded();
	const result = await create({ name: " Watcher ", job: "Watch the build.\n" });
	await create({ name: "Shepherd", job: "Merge my pull requests.", kind: "pr-shepherd", cwd: dir });
	const requests = left();
	expect(requests).toHaveLength(2);
	expect(requests).toEqual(
		expect.arrayContaining([
			{ botId: "eggbot", create: { id: expect.stringMatching(UUID), kind: "routines", name: "Watcher", job: "Watch the build.", cwd: lab } },
			{ botId: "eggbot", create: { id: expect.stringMatching(UUID), kind: "pr-shepherd", name: "Shepherd", job: "Merge my pull requests.", cwd: dir } },
		]),
	);
	expect(requests[0].create.id).not.toBe(requests[1].create.id);
	expect(result.content[0]?.text).toBe(`Asked the dashboard to create Watcher, a Routines Bot in ${lab}. It shows in the Bots tab once the dashboard applies it.`);
});

test("an empty name, an unknown kind, a workspace that is no absolute directory, or a session that is not a designer leaves nothing", async () => {
	const { dir, create, left } = loaded();
	await expect(create({ name: "  ", job: "Watch the build." })).rejects.toThrow("name is empty.");
	await expect(create({ name: "Watcher", job: "Watch the build.", kind: "janitor" })).rejects.toThrow("kind must be one of bot-designer, routines, pr-shepherd, router.");
	await expect(create({ name: "Watcher", job: "Watch the build.", cwd: "work/lab" })).rejects.toThrow("is not the absolute path of a directory.");
	await expect(create({ name: "Watcher", job: "Watch the build.", cwd: join(dir, "missing") })).rejects.toThrow("is not the absolute path of a directory.");
	expect(left()).toEqual([]);
	const plain = loaded([BOT_FLAGS.bot]);
	await expect(plain.create({ name: "Watcher", job: "Watch the build." })).rejects.toThrow("This session is not an omp-agents Bot designer.");
	expect(plain.left()).toEqual([]);
	expect(plain.prompt()).toBeUndefined();
});

test("a designer's main agent hears what create_bot does and that it cannot edit other Bots, and its subagents do not", () => {
	const { prompt } = loaded();
	const lines = prompt()!;
	expect(lines[0]).toBe("base");
	expect(lines[1]).toContain(`\`${CREATE_TOOL}\` asks the dashboard to create one new Bot`);
	expect(lines[1]).toContain("You cannot edit or delete any Bot");
	expect(prompt("sub")).toBeUndefined();
});
