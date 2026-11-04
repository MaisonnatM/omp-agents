/** `Openable`, an image of Markdown text that opens large, and `useMarkdownImages`, the viewer that steps through a text's images in the order it shows them. */
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { ImageViewer } from "./media-viewer";

/** Opens the image an `Openable` holds, given that `Openable`; `null`, the default, leaves images as they are. */
export const OpenMarkdownImage = createContext<((element: HTMLElement) => void) | null>(null);

/**
 * An image that opens large through `OpenMarkdownImage` when one is provided. `src` is before `mediaSrc`, which the
 * viewer applies itself, and `detail` is said under the viewer's title, such as the image's path.
 */
export function Openable({ src, alt, detail, title, className, children }: { src: string; alt: string | undefined; detail?: string; title?: string; className?: string; children: ReactNode }) {
	const open = useContext(OpenMarkdownImage);
	if (!open) return children;
	return (
		<button
			{...activityControl("media-viewer.open")}
			type="button"
			data-markdown-image={src}
			data-caption={alt || "Image"}
			data-detail={detail}
			title={title}
			aria-label={`Open ${alt || "image"}`}
			className={cn("cursor-zoom-in", className)}
			onClick={event => {
				event.preventDefault();
				open(event.currentTarget);
			}}
		>
			{children}
		</button>
	);
}

interface ShownImages {
	images: { src: string; caption: string; detail: string | undefined }[];
	index: number;
}

/** The opener for the `Openable`s under `root`, and the viewer it shows: the one clicked, the others a step away in the order `root` shows them. */
export function useMarkdownImages(root: RefObject<HTMLElement | null>): { open: (element: HTMLElement) => void; viewer: ReactNode } {
	const [shown, setShown] = useState<ShownImages | null>(null);
	const open = useCallback(
		(element: HTMLElement) => {
			const openers = [...root.current!.querySelectorAll<HTMLElement>("[data-markdown-image]")];
			setShown({ images: openers.map(opener => ({ src: opener.dataset.markdownImage!, caption: opener.dataset.caption!, detail: opener.dataset.detail })), index: openers.indexOf(element) });
		},
		[root],
	);
	const image = shown?.images[shown.index];
	const viewer = shown && image && (
		<ImageViewer
			src={image.src}
			caption={image.caption}
			detail={image.detail}
			index={shown.index}
			count={shown.images.length}
			previousLabel="Previous image"
			nextLabel="Next image"
			onIndex={index => setShown({ ...shown, index })}
			onClose={() => setShown(null)}
		/>
	);
	return { open, viewer };
}
