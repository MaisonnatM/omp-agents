/** File writes that never leave a half-written file behind. */
import { randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Replaces `path` with `text` through a temporary file beside it, so a reader sees the old file or the new one, never
 * part of either. The temporary file is created with `mode`, and removed when the write fails.
 */
export async function atomicWriteText(path: string, text: string, mode?: number): Promise<void> {
	const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
	const handle = await open(temp, "wx", mode);
	try {
		try {
			await handle.writeFile(text);
		} finally {
			await handle.close();
		}
		await rename(temp, path);
	} catch (err) {
		await rm(temp, { force: true });
		throw err;
	}
}
