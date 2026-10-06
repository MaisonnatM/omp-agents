/** Reads the text file that a path in agent text names, for the page's file dialog (`GET /api/file`). */
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { HOME } from "./paths";
import { MAX_TEXT_FILE_BYTES, TEXT_FILE_EXTENSIONS, type TextFile } from "./shared";

export type TextFileRead = { ok: true; file: TextFile } | { ok: false; status: 400 | 404 | 415; error: string };

const refuse = (status: 400 | 404 | 415, error: string): TextFileRead => ({ ok: false, status, error });

/**
 * The file that `path`, absolute or `~/`-relative, names. Its real path, past any symlink, must end in one of
 * `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot open a key or the access token, and its bytes must be UTF-8.
 */
export async function readTextFile(path: string): Promise<TextFileRead> {
	const named = path.startsWith("~/") ? join(HOME, path.slice(2)) : isAbsolute(path) ? resolve(path) : null;
	if (named === null) return refuse(400, "Expected ?path= naming a file by an absolute or ~/ path");
	const real = await realpath(named).catch(() => null);
	const info = real === null ? null : await stat(real);
	if (real === null || !info?.isFile()) return refuse(404, `No file ${named}`);
	if (!TEXT_FILE_EXTENSIONS.includes(extname(real).slice(1).toLowerCase())) {
		return refuse(415, `Only text files open here: ${TEXT_FILE_EXTENSIONS.map(ext => `.${ext}`).join(", ")}`);
	}
	const truncated = info.size > MAX_TEXT_FILE_BYTES;
	const bytes = await Bun.file(real).slice(0, MAX_TEXT_FILE_BYTES).bytes();
	let text: string;
	try {
		// `stream` holds back a character that the cut splits instead of failing on it.
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated });
	} catch {
		return refuse(415, `${named} is not UTF-8 text`);
	}
	return { ok: true, file: { path: named, text, size: info.size, truncated } };
}
