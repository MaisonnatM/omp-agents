/**
 * `Openable`, an image of Markdown text that opens large; `useImageList`, the viewer that steps through a list of images;
 * and `useMarkdownImages`, that viewer over a text's images in the order it shows them.
 */
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

/** One image of a list `useImageList` shows: `detail` is said under the viewer's title, such as the image's path. */
export interface ListedImage {
	src: string;
	caption: string;
	detail?: string;
}

interface ShownImages {
	images: ListedImage[];
	index: number;
}

/** `show` opens the viewer on `images[index]`, the others a step away; `viewer` is what to render, null while closed. */
export function useImageList(): { show: (images: ListedImage[], index: number) => void; viewer: ReactNode } {
	const [shown, setShown] = useState<ShownImages | null>(null);
	const show = useCallback((images: ListedImage[], index: number) => setShown({ images, index }), []);
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
	return { show, viewer };
}

/** The opener for the `Openable`s under `root`, and the viewer it shows: the one clicked, the others a step away in the order `root` shows them. */
export function useMarkdownImages(root: RefObject<HTMLElement | null>): { open: (element: HTMLElement) => void; viewer: ReactNode } {
	const { show, viewer } = useImageList();
	const open = useCallback(
		(element: HTMLElement) => {
			const openers = [...root.current!.querySelectorAll<HTMLElement>("[data-markdown-image]")];
			show(
				openers.map(opener => ({ src: opener.dataset.markdownImage!, caption: opener.dataset.caption!, detail: opener.dataset.detail })),
				openers.indexOf(element),
			);
		},
		[root, show],
	);
	return { open, viewer };
}
