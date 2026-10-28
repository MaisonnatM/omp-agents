/** The one rule for which attached files a prompt carries, applied both as files attach and as a prompt sends. */
import { MAX_PROMPT_DOCUMENT_BYTES, MAX_PROMPT_FILE_CHARS, type PromptFile, withFiles } from "../src/shared/prompt-files";
import { MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES, type PromptImage } from "../src/shared/sessions";
import { errorText } from "../src/json";

const MB = 1024 * 1024;

/** What a prompt sends for one attached file. */
export type AttachmentRead = { kind: "image"; image: PromptImage } | { kind: "file"; file: PromptFile };

/** A file the composer holds, with its read, started as it attaches. */
export interface Attachment {
	file: File;
	read: Promise<AttachmentRead>;
}

export interface PreparedPrompt {
	/** The text with the accepted text files after it. */
	prompt: string;
	images: PromptImage[];
	/** The attachments the prompt carries, in attach order. */
	accepted: Attachment[];
	/** Why each other attachment stayed out. */
	refused: string[];
}

/** A paste over either limit attaches as a text file instead of filling the text field, as ChatGPT and Claude do. */
export const LONG_PASTE_CHARS = 2_000;
export const LONG_PASTE_LINES = 40;

/** `text` as a file named `Pasted text.txt`, numbered past the names `attached` holds, when it is long enough to attach; else `null`. */
export function pastedTextFile(text: string, attached: readonly File[]): File | null {
	if (text.length <= LONG_PASTE_CHARS && text.split("\n").length <= LONG_PASTE_LINES) return null;
	const taken = new Set(attached.map(file => file.name));
	let name = "Pasted text.txt";
	for (let n = 2; taken.has(name); n++) name = `Pasted text ${n}.txt`;
	return new File([text], name, { type: "text/plain" });
}

/** Why `files` that their sizes alone keep out stayed out, and the rest in order; `images`: the subject takes images. */
export function screenFiles(files: readonly File[], images: boolean): { kept: File[]; refused: string[] } {
	const refused: string[] = [];
	let imageBytes = 0;
	const kept = files.filter(file => {
		if (!PROMPT_IMAGE_TYPES.includes(file.type)) {
			if (file.size <= MAX_PROMPT_DOCUMENT_BYTES) return true;
			refused.push(`A file attaches up to ${MAX_PROMPT_DOCUMENT_BYTES / MB} MB, so ${file.name} stayed out.`);
			return false;
		}
		if (!images) {
			refused.push(`A subagent takes text only, so ${file.name} stayed out.`);
			return false;
		}
		if (imageBytes + file.size > MAX_PROMPT_IMAGE_BYTES) {
			refused.push(`A prompt carries up to ${MAX_PROMPT_IMAGE_BYTES / MB} MB of images, so ${file.name} stayed out.`);
			return false;
		}
		imageBytes += file.size;
		return true;
	});
	return { kept, refused };
}

/**
 * Await every attachment's read and keep, in attach order, those that read and fit the prompt's limits.
 * The composer runs this as files attach to show what stays out, and again on the snapshot it sends, so a file refused while its read was pending never reaches a prompt.
 */
export async function preparePrompt(attachments: readonly Attachment[], text: string, images: boolean): Promise<PreparedPrompt> {
	const screened = screenFiles(
		attachments.map(attachment => attachment.file),
		images,
	);
	const refused = [...screened.refused];
	const candidates = attachments.filter(attachment => screened.kept.includes(attachment.file));
	const reads = await Promise.allSettled(candidates.map(attachment => attachment.read));
	const accepted: Attachment[] = [];
	const files: PromptFile[] = [];
	const imagesOut: PromptImage[] = [];
	let chars = 0;
	reads.forEach((result, index) => {
		const attachment = candidates[index]!;
		const { name } = attachment.file;
		if (result.status === "rejected") {
			refused.push(`${name} stayed out. ${errorText(result.reason)}`);
			return;
		}
		const read = result.value;
		if (read.kind === "image") imagesOut.push(read.image);
		else if (chars + read.file.text.length > MAX_PROMPT_FILE_CHARS) {
			refused.push(`A prompt carries up to ${MAX_PROMPT_FILE_CHARS.toLocaleString("en-US")} characters of files, so ${name} stayed out.`);
			return;
		} else {
			chars += read.file.text.length;
			files.push(read.file);
		}
		accepted.push(attachment);
	});
	return { prompt: withFiles(text, files), images: imagesOut, accepted, refused };
}
