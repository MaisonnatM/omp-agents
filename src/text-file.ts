/** Reads the text file that a path in agent text names, for the page's file dialog (`GET /api/file`). */
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { agentDir } from "./omp/config";
import { HOME, tokenFile } from "./paths";
import { MAX_TEXT_FILE_BYTES, TEXT_FILE_EXTENSIONS, type TextFile } from "./shared/transcript";

export type TextFileRead = { ok: true; file: TextFile } | { ok: false; status: 400 | 403 | 404 | 415; error: string };

/** A directory whose files the dialog never opens, but for those with an extension in `opens`. */
export interface DeniedDir {
	dir: string;
	opens: readonly string[];
}

/**
 * Where sign-in material and config live, so a script that got into the page cannot read them through this server:
 * omp-agents' own directory, with its access token, and omp's agent directory, with its credential store, its MCP
 * config and the headers that config sends, and `config.yml`. omp's instructions there, `AGENTS.md` and skills, are
 * Markdown, which holds no credentials, and still open.
 */
export const DENIED_DIRS: readonly DeniedDir[] = [
	{ dir: dirname(tokenFile), opens: [] },
	{ dir: agentDir, opens: ["md", "markdown"] },
];

const refuse = (status: 400 | 403 | 404 | 415, error: string): TextFileRead => ({ ok: false, status, error });

/** Whether real path `real` is `dir`, or inside it, once `dir` is real too; a directory that does not exist yet is compared as named. */
async function within(dir: string, real: string): Promise<boolean> {
	const root = await realpath(dir).catch(() => resolve(dir));
	return real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The file that `path`, absolute or `~/`-relative, names. Its real path, past any symlink, must end in one of
 * `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot open a key or the access token, must lie outside `denied`
 * but for the extensions each allows, and its bytes must be UTF-8.
 */
export async function readTextFile(path: string, denied: readonly DeniedDir[] = DENIED_DIRS): Promise<TextFileRead> {
	const named = path.startsWith("~/") ? join(HOME, path.slice(2)) : isAbsolute(path) ? resolve(path) : null;
	if (named === null) return refuse(400, "Expected ?path= naming a file by an absolute or ~/ path");
	const real = await realpath(named).catch(() => null);
	const info = real === null ? null : await stat(real);
	if (real === null || !info?.isFile()) return refuse(404, `No file ${named}`);
	const extension = extname(real).slice(1).toLowerCase();
	if (!TEXT_FILE_EXTENSIONS.includes(extension)) {
		return refuse(415, `Only text files open here: ${TEXT_FILE_EXTENSIONS.map(ext => `.${ext}`).join(", ")}`);
	}
	for (const { dir, opens } of denied) {
		if (!opens.includes(extension) && (await within(dir, real))) return refuse(403, `${named} is in ${dir}, which holds sign-ins and config and does not open here`);
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
