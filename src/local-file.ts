/** Reads the files that a path in agent text names: text for the page's file dialog (`GET /api/file`), images and videos for `GET /api/media`. */
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { agentDir } from "./omp/config";
import { expandHome, tokenFile } from "./paths";
import { MAX_TEXT_FILE_BYTES, MEDIA_FILE_EXTENSIONS, TEXT_FILE_EXTENSIONS, type TextFile } from "./shared/transcript";

type Refusal = { ok: false; status: 400 | 403 | 404 | 415; error: string };
export type TextFileRead = { ok: true; file: TextFile } | Refusal;
/** A media file found: its real path and its lower-case extension, which names its type. */
export type MediaFileFind = { ok: true; real: string; extension: string } | Refusal;

/** A directory whose files the page never opens, but for those with an extension in `opens`. */
export interface DeniedDir {
	dir: string;
	opens: readonly string[];
}

/**
 * Where sign-in material and config live, so a script that got into the page cannot read them through this server:
 * omp-agents' own directory, with its access token, and omp's agent directory, with its credential store, its MCP
 * config and the headers that config sends, and `config.yml`. omp's instructions there, `AGENTS.md` and skills, are
 * Markdown, and the images and videos its sessions keep are media; neither holds credentials, so both still open.
 */
export const DENIED_DIRS: readonly DeniedDir[] = [
	{ dir: dirname(tokenFile), opens: [] },
	{ dir: agentDir, opens: ["md", "markdown", ...MEDIA_FILE_EXTENSIONS] },
];

const refuse = (status: Refusal["status"], error: string): Refusal => ({ ok: false, status, error });

/** Whether real path `real` is `dir`, or inside it, once `dir` is real too; a directory that does not exist yet is compared as named. */
async function within(dir: string, real: string): Promise<boolean> {
	const root = await realpath(dir).catch(() => resolve(dir));
	return real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The file that `path`, absolute or `~`-relative, names. Its real path, past any symlink, must end in one of
 * `extensions`, so a link named `notes.md` or `shot.png` cannot open a key or the access token, and must lie outside
 * `denied` but for the extensions each allows. `kind` names the files in a refusal.
 */
async function findFile(path: string, extensions: readonly string[], kind: string, denied: readonly DeniedDir[]) {
	const home = expandHome(path);
	const named = isAbsolute(home) ? resolve(home) : null;
	if (named === null) return refuse(400, "Expected ?path= naming a file by an absolute or ~/ path");
	const real = await realpath(named).catch(() => null);
	const info = real === null ? null : await stat(real);
	if (real === null || !info?.isFile()) return refuse(404, `No file ${named}`);
	const extension = extname(real).slice(1).toLowerCase();
	if (!extensions.includes(extension)) return refuse(415, `Only ${kind} open here: ${extensions.map(ext => `.${ext}`).join(", ")}`);
	for (const { dir, opens } of denied) {
		if (!opens.includes(extension) && (await within(dir, real))) return refuse(403, `${named} is in ${dir}, which holds sign-ins and config and does not open here`);
	}
	return { ok: true as const, named, real, extension, size: info.size };
}

/** The text file that `path` names, as {@link findFile} checks it, whose bytes must be UTF-8. */
export async function readTextFile(path: string, denied: readonly DeniedDir[] = DENIED_DIRS): Promise<TextFileRead> {
	const found = await findFile(path, TEXT_FILE_EXTENSIONS, "text files", denied);
	if (!found.ok) return found;
	const { named, real, size } = found;
	const truncated = size > MAX_TEXT_FILE_BYTES;
	const bytes = await Bun.file(real).slice(0, MAX_TEXT_FILE_BYTES).bytes();
	let text: string;
	try {
		// `stream` holds back a character that the cut splits instead of failing on it.
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated });
	} catch {
		return refuse(415, `${named} is not UTF-8 text`);
	}
	return { ok: true, file: { path: named, text, size, truncated } };
}

/** The image or video that `path` names, one of `MEDIA_FILE_EXTENSIONS`, as {@link findFile} checks it. */
export async function findMediaFile(path: string, denied: readonly DeniedDir[] = DENIED_DIRS): Promise<MediaFileFind> {
	const found = await findFile(path, MEDIA_FILE_EXTENSIONS, "images and videos", denied);
	return found.ok ? { ok: true, real: found.real, extension: found.extension } : found;
}
