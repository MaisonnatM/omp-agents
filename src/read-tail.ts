/** The end of a file that only grows, read without reading the rest. */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * The whole lines within the last `maxBytes` of the file at `path`, and whether it holds more before them: a cut read
 * drops its first line, the end of an earlier one. `null` when the file is gone.
 */
export function readTail(path: string, maxBytes: number): { text: string; cut: boolean } | null {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		const size = fstatSync(fd).size;
		// One byte more than the limit tells whether the limit's first line starts whole, after a line break.
		const length = Math.min(size, maxBytes + 1);
		const bytes = Buffer.alloc(length);
		readSync(fd, bytes, 0, length, size - length);
		const text = bytes.toString("utf8");
		if (size <= maxBytes) return { text, cut: false };
		const lineEnd = text.indexOf("\n");
		return { text: lineEnd === -1 ? "" : text.slice(lineEnd + 1), cut: true };
	} finally {
		closeSync(fd);
	}
}
