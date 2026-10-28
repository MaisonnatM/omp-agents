/** The composer's attach button and the hook that reads attached files into a prompt's images and text. */
import { Paperclip } from "lucide-react";
import { type ClipboardEvent, useState } from "react";
import { plainText, type PromptDocument } from "../../src/shared/prompt-files";
import { PROMPT_IMAGE_TYPES, type PromptImage } from "../../src/shared/sessions";
import { errorText } from "../../src/json";
import { putJson } from "../api";
import { type Attachment, type AttachmentRead, pastedTextFile, preparePrompt, screenFiles } from "../prompt-attachments-model";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** The composer's `accept`: any file; each is read as an image, as text, or as a document omp converts, or refused with a note. */
export const ATTACH_ACCEPT = "*/*";

export interface PromptAttachments {
	files: File[];
	onFilesChange: (files: File[]) => void;
	/** Why files the user added stayed out of the prompt, or why the server did not take a prompt; else `null`. */
	note: string | null;
	/**
	 * Empty the composer's files and hand `text` with those {@link preparePrompt} accepts to `deliver`: text files after the text,
	 * images apart. When `deliver` rejects, the accepted files come back with a note, and `undo` runs too.
	 */
	take: (text: string, deliver: (prompt: string, images: PromptImage[]) => Promise<void>, undo: () => void) => Promise<void>;
	/** Hand `text` with the composer's accepted files to `deliver` as {@link take} does, keeping them attached. */
	read: (text: string, deliver: (prompt: string, images: PromptImage[]) => void) => Promise<void>;
	/** Attach images a queued message carried, after the files already attached. */
	restore: (images: PromptImage[]) => void;
	/** The text field's paste handler: long pasted text attaches as a file, so the text field stays readable. */
	onPaste: (event: ClipboardEvent<HTMLElement>) => void;
}

/** `file`'s bytes in base64, as the server's JSON bodies carry a file. */
export function fileBase64(file: Blob): Promise<string> {
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
async function readFile(file: File): Promise<AttachmentRead> {
	if (PROMPT_IMAGE_TYPES.includes(file.type)) return { kind: "image", image: { data: await fileBase64(file), mimeType: file.type } };
	const text = plainText(new Uint8Array(await file.arrayBuffer()));
	if (text !== null) return { kind: "file", file: { name: file.name, text } };
	const document: PromptDocument = { name: file.name, data: await fileBase64(file) };
	const converted = await putJson<{ text: string }>("/api/attachment/document", document);
	return { kind: "file", file: { name: file.name, text: converted.text } };
}

const joined = (refused: string[]): string | null => (refused.length > 0 ? refused.join(" ") : null);

/**
 * The files a composer attaches to its next prompt. Each is read as it attaches, so a document converts while the user
 * types, and {@link preparePrompt} decides both which stay attached and which a prompt carries. `images`: the subject takes images; omp sends a subagent text only.
 */
export function usePromptAttachments(images: boolean): PromptAttachments {
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [note, setNote] = useState<string | null>(null);

	/** Drop what `prepared` refused from `snapshot`, unless the files changed since; a change runs its own check. */
	const keepAccepted = (snapshot: Attachment[], accepted: Attachment[], refused: string[]): void => {
		if (refused.length === 0) return;
		setAttachments(current => (current === snapshot ? current.filter(attachment => accepted.includes(attachment)) : current));
		setNote(current => [current, ...refused].filter(Boolean).join(" "));
	};

	const onFilesChange = (next: File[]): void => {
		const { kept, refused } = screenFiles(next, images);
		const snapshot = kept.map(file => attachments.find(attachment => attachment.file === file) ?? { file, read: readFile(file) });
		setAttachments(snapshot);
		setNote(joined(refused));
		void preparePrompt(snapshot, "", images).then(prepared => keepAccepted(snapshot, prepared.accepted, prepared.refused));
	};

	const take = async (text: string, deliver: (prompt: string, images: PromptImage[]) => Promise<void>, undo: () => void): Promise<void> => {
		const taken = attachments;
		setAttachments([]);
		setNote(null);
		const prepared = await preparePrompt(taken, text, images);
		setNote(joined(prepared.refused));
		if (prepared.accepted.length === 0 && taken.length > 0 && text === "") return undo();
		try {
			await deliver(prepared.prompt, prepared.images);
		} catch (error) {
			setNote([`The prompt failed: ${errorText(error)}`, ...prepared.refused].join(" "));
			setAttachments(current => [...prepared.accepted, ...current.filter(attachment => !prepared.accepted.includes(attachment))]);
			undo();
		}
	};

	const read = async (text: string, deliver: (prompt: string, images: PromptImage[]) => void): Promise<void> => {
		const snapshot = attachments;
		const prepared = await preparePrompt(snapshot, text, images);
		keepAccepted(snapshot, prepared.accepted, prepared.refused);
		if (prepared.accepted.length === 0 && snapshot.length > 0 && text === "") return;
		deliver(prepared.prompt, prepared.images);
	};

	const restore = (restoredImages: PromptImage[]): void => {
		if (restoredImages.length === 0) return;
		const restored = restoredImages.map(
			({ data, mimeType }, index) => new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], `queued-${index + 1}.${mimeType.split("/")[1]}`, { type: mimeType }),
		);
		onFilesChange([...attachments.map(attachment => attachment.file), ...restored]);
	};

	const files = attachments.map(attachment => attachment.file);
	const onPaste = (event: ClipboardEvent<HTMLElement>): void => {
		if (event.clipboardData.files.length > 0) return;
		const file = pastedTextFile(event.clipboardData.getData("text/plain"), files);
		if (!file) return;
		event.preventDefault();
		onFilesChange([...files, file]);
	};
	return { files, onFilesChange, onPaste, note, take, read, restore };
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
