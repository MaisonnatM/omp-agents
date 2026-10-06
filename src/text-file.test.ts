import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TEXT_FILE_BYTES } from "./shared";
import { readTextFile } from "./text-file";

const dir = await mkdtemp(join(tmpdir(), "omp-agents-text-file-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("a text file reads whole, under the path it was named by", async () => {
	await writeFile(join(dir, "report.tsv"), "a\tb\n1\t2\n");
	expect(await readTextFile(join(dir, "report.tsv"))).toEqual({
		ok: true,
		file: { path: join(dir, "report.tsv"), text: "a\tb\n1\t2\n", size: 8, truncated: false },
	});
});

test("a link named like a text file cannot open a file of another type", async () => {
	await writeFile(join(dir, "token"), "secret");
	await symlink(join(dir, "token"), join(dir, "notes.md"));
	expect(await readTextFile(join(dir, "notes.md"))).toMatchObject({ ok: false, status: 415 });
});

test("a relative path, a directory, a missing file, and binary bytes are refused", async () => {
	await writeFile(join(dir, "image.txt"), new Uint8Array([0x89, 0x50, 0xff, 0xfe]));
	expect(await readTextFile("notes.md")).toMatchObject({ ok: false, status: 400 });
	expect(await readTextFile(dir)).toMatchObject({ ok: false, status: 404 });
	expect(await readTextFile(join(dir, "missing.md"))).toMatchObject({ ok: false, status: 404 });
	expect(await readTextFile(join(dir, "image.txt"))).toMatchObject({ ok: false, status: 415 });
});

test("a large file stops at the limit without splitting a character", async () => {
	// "é" is two bytes, so the limit falls inside the last one.
	await writeFile(join(dir, "big.log"), `${"a".repeat(MAX_TEXT_FILE_BYTES - 1)}é and more`);
	const read = await readTextFile(join(dir, "big.log"));
	if (!read.ok) throw new Error(read.error);
	expect(read.file.truncated).toBe(true);
	expect(read.file.text).toBe("a".repeat(MAX_TEXT_FILE_BYTES - 1));
});
