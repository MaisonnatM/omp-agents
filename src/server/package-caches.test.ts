import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneKeeping } from "./package-caches";

let root = "";
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function cache(): Promise<{ used: string; unused: string; keep: string }> {
	root = await mkdtemp(join(tmpdir(), "package-caches-"));
	const used = join(root, "uv", "archive-v0", "used");
	const unused = join(root, "uv", "archive-v0", "unused");
	await mkdir(join(used, "bin"), { recursive: true });
	await mkdir(unused, { recursive: true });
	await writeFile(join(used, "bin", "tool"), "tool");
	await writeFile(join(used, "lib.py"), "lib");
	await writeFile(join(unused, "old.py"), "old");
	return { used, unused, keep: join(root, ".keep") };
}

test("an entry a running process uses survives a prune that removes it whole or in part, with the same files", async () => {
	const { used, unused, keep } = await cache();
	const before = (await stat(join(used, "lib.py"))).ino;
	await pruneKeeping([used], keep, async () => {
		await rm(join(used, "bin"), { recursive: true });
		await rm(unused, { recursive: true });
	});
	expect(await readFile(join(used, "bin", "tool"), "utf8")).toBe("tool");
	expect((await stat(join(used, "lib.py"))).ino).toBe(before);
	expect(await readdir(join(root, "uv", "archive-v0"))).toEqual(["used"]);
	expect(await readdir(root)).toEqual(["uv"]);
});

test("a failed prune still puts back what it removed, then reports its error", async () => {
	const { used, keep } = await cache();
	await expect(pruneKeeping([used], keep, async () => {
		await rm(used, { recursive: true });
		throw new Error("Permission denied");
	})).rejects.toThrow("Permission denied");
	expect(await readFile(join(used, "lib.py"), "utf8")).toBe("lib");
	expect(await readdir(root)).toEqual(["uv"]);
});
