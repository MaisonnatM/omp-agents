import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_PROMPT_DOCUMENT_BYTES, MAX_PROMPT_FILE_CHARS, plainText, type PromptDocument, type PromptFile, withFiles } from "../../src/shared/prompt-files";
import { MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES, type PromptImage } from "../../src/shared/sessions";
import { errorText, putJson } from "../api";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** The composer's `accept`: any file; each is read as an image, as text, or as a document omp converts, or refused with a note. */
export const ATTACH_ACCEPT = "*/*";

const MB = 1024 * 1024;

/** What a prompt sends for one attached file. */
type Read = { kind: "image"; image: PromptImage } | { kind: "file"; file: PromptFile };

/** A file's read, started as it attaches, and the characters it adds to the prompt once read as text. */
interface Attached {
	read: Promise<Read>;
	chars: number;
}

export interface PromptAttachments {
	files: File[];
	onFilesChange: (files: File[]) => void;
	/** Why files the user added stayed out of the prompt, or why a prompt's files could not be read; else `null`. */
	note: string | null;
	/**
	 * Empty the composer's files and hand `text` with them to `deliver` as a prompt sends it: text files after the text,
	 * images apart. When they cannot be read, they come back with a note, and `undo` runs instead.
	 */
	take: (text: string, deliver: (prompt: string, images: PromptImage[]) => void, undo: () => void) => void;
	/** Hand `text` with the composer's files to `deliver` as {@link take} does, keeping them attached. */
	read: (text: string, deliver: (prompt: string, images: PromptImage[]) => void) => void;
	/** Attach images a queued message carried, after the files already attached. */
	restore: (images: PromptImage[]) => void;
}

/** `file`'s bytes in base64, as the server's JSON bodies carry a file. */
export function fileBase64(file: File): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () => {
		const url = String(reader.result);
		resolve(url.slice(url.indexOf(",") + 1));
	};
	reader.onerror = () => reject(reader.error);
	reader.readAsDataURL(file);
	return promise;
}

/** An image as omp's `ImageContent`, a text file as its text, and any other file as the text omp converts it to. */
async function readFile(file: File): Promise<Read> {
	if (PROMPT_IMAGE_TYPES.includes(file.type)) return { kind: "image", image: { data: await fileBase64(file), mimeType: file.type } };
	const text = plainText(new Uint8Array(await file.arrayBuffer()));
	if (text !== null) return { kind: "file", file: { name: file.name, text } };
	const document: PromptDocument = { name: file.name, data: await fileBase64(file) };
	const converted = await putJson<{ text: string }>("/api/attachment/document", document);
	return { kind: "file", file: { name: file.name, text: converted.text } };
}

/**
 * The files a composer attaches to its next prompt. Each is read as it attaches, so a document converts while the user
 * types. `images`: the subject takes images; omp sends a subagent text only.
 */
export function usePromptAttachments(images: boolean): PromptAttachments {
	const [files, setFiles] = useState<File[]>([]);
	const [note, setNote] = useState<string | null>(null);
	const attached = useRef(new Map<File, Attached>());

	const refuse = (file: File, why: string): void => {
		attached.current.delete(file);
		setFiles(current => current.filter(other => other !== file));
		setNote(current => (current ? `${current} ${why}` : why));
	};

	const attach = (file: File): void => {
		const entry: Attached = { read: readFile(file), chars: 0 };
		attached.current.set(file, entry);
		entry.read.then(
			read => {
				if (read.kind !== "file" || attached.current.get(file) !== entry) return;
				const others = [...attached.current.values()].reduce((sum, other) => sum + other.chars, 0);
				if (others + read.file.text.length > MAX_PROMPT_FILE_CHARS) {
					refuse(file, `A prompt carries up to ${MAX_PROMPT_FILE_CHARS.toLocaleString("en-US")} characters of files, so ${file.name} stayed out.`);
				} else entry.chars = read.file.text.length;
			},
			(err: unknown) => {
				if (attached.current.get(file) === entry) refuse(file, `${file.name} stayed out. ${errorText(err)}`);
			},
		);
	};

	const onFilesChange = (next: File[]): void => {
		for (const file of attached.current.keys()) if (!next.includes(file)) attached.current.delete(file);
		const refused: string[] = [];
		let imageBytes = 0;
		const kept = next.filter(file => {
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
		for (const file of kept) if (!attached.current.has(file)) attach(file);
		setNote(refused.length > 0 ? refused.join(" ") : null);
		setFiles(kept);
	};

	const send = (chosen: File[], text: string, deliver: (prompt: string, images: PromptImage[]) => void, failed?: () => void): void => {
		if (chosen.length === 0) return deliver(text, []);
		const reads = chosen.map(file => attached.current.get(file)?.read ?? readFile(file));
		Promise.all(reads).then(
			read => deliver(withFiles(text, read.flatMap(r => (r.kind === "file" ? [r.file] : []))), read.flatMap(r => (r.kind === "image" ? [r.image] : []))),
			() => {
				setNote("The attached files could not be read. Remove them and attach them again.");
				failed?.();
			},
		);
	};

	const take = (text: string, deliver: (prompt: string, images: PromptImage[]) => void, undo: () => void): void => {
		const taken = files;
		setFiles([]);
		setNote(null);
		send(
			taken,
			text,
			(prompt, sent) => {
				for (const file of taken) attached.current.delete(file);
				deliver(prompt, sent);
			},
			() => {
				setFiles(taken);
				undo();
			},
		);
	};

	const restore = (images: PromptImage[]): void => {
		if (images.length === 0) return;
		const restored = images.map(
			({ data, mimeType }, index) => new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], `queued-${index + 1}.${mimeType.split("/")[1]}`, { type: mimeType }),
		);
		onFilesChange([...files, ...restored]);
	};
	return { files, onFilesChange, note, take, read: (text, deliver) => send(files, text, deliver), restore };
}

/** Opens the file picker. Dropping or pasting a file into the composer attaches it too. */
export function AttachButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
	return (
		<Tooltip content="Attach images, text files, or documents, or drop or paste them" side="top">
			<Button variant="ghost" size="icon-sm" aria-label="Attach files" disabled={disabled} onClick={onClick}>
				<Paperclip aria-hidden="true" />
			</Button>
		</Tooltip>
	);
}
