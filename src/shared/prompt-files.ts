/** A file a prompt carries as text: its name, and its text or a document's text as omp converts it. */
export interface PromptFile {
	name: string;
	text: string;
}

/** The most characters attached files add to one prompt, about 250k tokens. */
export const MAX_PROMPT_FILE_CHARS = 1_000_000;
/** The largest file the composer attaches as text, and the largest document `PUT /api/attachment/document` converts. */
export const MAX_PROMPT_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** `PUT /api/attachment/document`: a document to convert to text, its bytes in base64. It answers `{ text }`. */
export interface PromptDocument {
	name: string;
	data: string;
}

/** `bytes` as text when they are UTF-8 without NUL bytes and not a PDF, which can be all ASCII; else `null`. */
export function plainText(bytes: Uint8Array): string | null {
	if (bytes.includes(0) || new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

const HEADER = /<file name="([^"\n]*)">\n/y;
const CLOSE = "\n</file>";

/**
 * `text` with `files` after it, each in the `<file name="…">` block omp's `@file` arguments write. They follow the
 * typed text so a leading `/skill:` or file command still expands, taking the files as its arguments.
 */
export function withFiles(text: string, files: PromptFile[]): string {
	const blocks = files.map(file => `<file name="${file.name.replace(/["\n]/g, "_")}">\n${file.text}\n</file>`);
	return [text, ...blocks].filter(Boolean).join("\n\n");
}

/**
 * The names of the blocks `prompt` holds from `at` to its end, or `null` when that is not blocks alone. A block ends at
 * the first `</file>` line the rest parses after, so a file whose text holds a block of its own still splits right.
 */
function blockNames(prompt: string, at: number): string[] | null {
	HEADER.lastIndex = at;
	const header = HEADER.exec(prompt);
	if (!header) return null;
	for (let close = prompt.indexOf(CLOSE, HEADER.lastIndex); close >= 0; close = prompt.indexOf(CLOSE, close + 1)) {
		const end = close + CLOSE.length;
		if (end === prompt.length) return [header[1]];
		const rest = prompt.startsWith("\n\n", end) ? blockNames(prompt, end + 2) : null;
		if (rest) return [header[1], ...rest];
	}
	return null;
}

/** A prompt's typed text and the names of the files {@link withFiles} put after it, first file first. */
export function splitFiles(prompt: string): { text: string; files: string[] } {
	if (!prompt.endsWith(CLOSE)) return { text: prompt, files: [] };
	for (let at = 0; at >= 0; at = prompt.indexOf('\n\n<file name="', at + 1)) {
		const files = blockNames(prompt, at === 0 ? 0 : at + 2);
		if (files) return { text: prompt.slice(0, at), files };
	}
	return { text: prompt, files: [] };
}

/** How a list shows a prompt: its typed text, or the names of its files when it carries files alone. */
export function promptLabel(prompt: string): string {
	const { text, files } = splitFiles(prompt);
	return text || files.join(", ");
}
