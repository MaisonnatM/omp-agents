import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InboxEntry, JsonInboxDir } from "./json-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-json-inbox-"));
	dirs.push(dir);
	return dir;
}

/** Numbers are requests; any other JSON is no request. */
const parseNumber = (_name: string, value: unknown): InboxEntry<number> => (typeof value === "number" ? { item: value } : { invalid: "not a number" });

describe("JsonInboxDir", () => {
	test("applies a valid file and removes it, and sets aside one that is not valid JSON or not a request", async () => {
		const dir = inboxDir();
		const logged = spyOn(console, "error").mockImplementation(() => {});
		writeFileSync(join(dir, "b.json"), "2");
		writeFileSync(join(dir, "a.json"), "1");
		writeFileSync(join(dir, "bad.json"), "{not json");
		writeFileSync(join(dir, "text.json"), '"two"');
		writeFileSync(join(dir, "c.tmp"), "3");
		const applied: number[] = [];
		await new JsonInboxDir(dir, { parse: parseNumber, apply: item => (applied.push(item), true) }).drain();
		expect(applied).toEqual([1, 2]);
		expect(readdirSync(dir).sort()).toEqual(["bad.json.invalid", "c.tmp", "text.json.invalid"]);
		logged.mockRestore();
	});

	test("a file that vanishes between the listing and the read is skipped, never thrown", async () => {
		const dir = inboxDir();
		// A dangling link is listed like a file whose writer deleted it, and reading it fails with ENOENT.
		symlinkSync(join(dir, "nowhere"), join(dir, "gone.json"));
		writeFileSync(join(dir, "here.json"), "1");
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const applied: number[] = [];
		await new JsonInboxDir(dir, { parse: parseNumber, apply: item => (applied.push(item), true) }).drain();
		expect(applied).toEqual([1]);
		expect(logged).not.toHaveBeenCalled();
		expect(readdirSync(dir)).toEqual(["gone.json"]);
		logged.mockRestore();
	});

	test("a file deleted while it is being set aside does not throw", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "a.json"), "1");
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const inbox = new JsonInboxDir<number>(dir, {
			parse(name) {
				rmSync(join(dir, name));
				return { invalid: "refused" };
			},
			apply: () => true,
		});
		await inbox.drain();
		expect(logged).toHaveBeenCalledTimes(1);
		expect(readdirSync(dir)).toEqual([]);
		logged.mockRestore();
	});

	test("a handler that returns false or throws: the first leaves the file, the second sets it aside", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "later.json"), "1");
		writeFileSync(join(dir, "broken.json"), "2");
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const inbox = new JsonInboxDir(dir, {
			parse: parseNumber,
			apply(item) {
				if (item === 2) throw new Error("boom");
				return false;
			},
		});
		await inbox.drain();
		expect(readdirSync(dir).sort()).toEqual(["broken.json.invalid", "later.json"]);
		expect(logged.mock.calls[0]?.[0]).toContain("applying it failed: boom");
		logged.mockRestore();
	});

	test("a request being applied is not applied again by a drain that starts meanwhile", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "a.json"), "1");
		const release = Promise.withResolvers<void>();
		let applied = 0;
		const inbox = new JsonInboxDir(dir, {
			parse: parseNumber,
			async apply() {
				applied++;
				await release.promise;
				return true;
			},
		});
		const first = inbox.drain();
		await inbox.drain();
		release.resolve();
		await first;
		expect(applied).toBe(1);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("an inactive inbox leaves every file alone, and a directory that does not exist drains nothing", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "a.json"), "1");
		writeFileSync(join(dir, "bad.json"), "{not json");
		const apply = () => {
			throw new Error("not this server's request");
		};
		await new JsonInboxDir(dir, { parse: parseNumber, apply }, { active: () => false }).drain();
		expect(readdirSync(dir).sort()).toEqual(["a.json", "bad.json"]);
		await new JsonInboxDir(join(dir, "gone"), { parse: parseNumber, apply }).drain();
	});
});
