import { Paperclip } from "lucide-react";
import { useState } from "react";
import { MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_TYPES, type PromptImage } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/** The composer's `accept`: the image types a prompt carries. */
export const IMAGE_ACCEPT = PROMPT_IMAGE_TYPES.join(",");

const MAX_MB = MAX_PROMPT_IMAGE_BYTES / (1024 * 1024);

export interface ImageAttachments {
	files: File[];
	onFilesChange: (files: File[]) => void;
	/** Why images the user added stayed out of the prompt, or why a prompt's images could not be read; else `null`. */
	note: string | null;
	/**
	 * Empty the composer's images and hand them to `deliver` as a prompt sends them. When they cannot be read, they come
	 * back with a note, and `undo` runs instead.
	 */
	take: (deliver: (images: PromptImage[]) => void, undo: () => void) => void;
	/** Hand the composer's images to `deliver` as a prompt sends them, keeping them attached; a note says when they cannot be read. */
	read: (deliver: (images: PromptImage[]) => void) => void;
}

/** The files as a prompt sends them: base64 and their type. */
function promptImages(files: File[]): Promise<PromptImage[]> {
	return Promise.all(
		files.map(
			file =>
				new Promise<PromptImage>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const url = String(reader.result);
						resolve({ data: url.slice(url.indexOf(",") + 1), mimeType: file.type });
					};
					reader.onerror = () => reject(reader.error);
					reader.readAsDataURL(file);
				}),
		),
	);
}

/** The images a composer attaches to its next prompt, as many as fit in the bytes one prompt carries. */
export function useImageAttachments(): ImageAttachments {
	const [files, setFiles] = useState<File[]>([]);
	const [note, setNote] = useState<string | null>(null);
	const onFilesChange = (next: File[]): void => {
		const kept: File[] = [];
		let total = 0;
		for (const file of next) {
			if (total + file.size > MAX_PROMPT_IMAGE_BYTES) continue;
			kept.push(file);
			total += file.size;
		}
		const left = next.filter(file => !kept.includes(file)).map(file => file.name);
		setNote(left.length > 0 ? `A prompt carries up to ${MAX_MB} MB of images, so ${left.join(", ")} stayed out.` : null);
		setFiles(kept);
	};
	const send = (chosen: File[], deliver: (images: PromptImage[]) => void, failed?: () => void): void => {
		if (chosen.length === 0) return deliver([]);
		promptImages(chosen).then(deliver, () => {
			setNote("The attached images could not be read. Remove them and attach them again.");
			failed?.();
		});
	};
	const take = (deliver: (images: PromptImage[]) => void, undo: () => void): void => {
		const taken = files;
		setFiles([]);
		setNote(null);
		send(taken, deliver, () => {
			setFiles(taken);
			undo();
		});
	};
	return { files, onFilesChange, note, take, read: deliver => send(files, deliver) };
}

/** Opens the file picker for images. Dropping or pasting an image into the composer attaches it too. */
export function AttachButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
	return (
		<Tooltip content="Attach images, or drop or paste them" side="top">
			<Button variant="ghost" size="icon-sm" aria-label="Attach images" disabled={disabled} onClick={onClick}>
				<Paperclip aria-hidden="true" />
			</Button>
		</Tooltip>
	);
}
