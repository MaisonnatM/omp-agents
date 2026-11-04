/** The images and videos on this computer that agent text names, shown in the message and opened large. */
import { Play } from "lucide-react";
import { useContext, useState } from "react";
import { mediaSrc } from "../api";
import { type FileBase, type FileTarget, fileTarget, linkedFile, mediaFileUrl } from "../file-paths";
import { DashboardActionsContext } from "./dashboard-context";
import { FileBaseContext } from "./file-link";
import { ImageViewer } from "./media-viewer";

interface Media {
	target: FileTarget;
	src: string;
	name: string;
	video: boolean;
}

/** The file `path` names against the message's `base`, its address, and whether it plays as a video; `null` when nothing resolves it or it is no media file. */
function mediaOf(path: string, base: FileBase | null): Media | null {
	const file = linkedFile(path);
	const target = fileTarget(path, base);
	if (!file || file.kind === "text" || target === null) return null;
	return { target, src: mediaSrc(mediaFileUrl(target)), name: target.path.slice(target.path.lastIndexOf("/") + 1), video: file.kind === "video" };
}

/** An image of agent text, `![alt](path)`, in place: an image, or a video that plays there. A path that loads nothing shows its `alt`. */
export function LocalMedia({ path, alt }: { path: string; alt: string }) {
	const media = mediaOf(path, useContext(FileBaseContext));
	const openFile = useContext(DashboardActionsContext)?.openFile;
	const [failed, setFailed] = useState(false);
	if (media === null || failed) return <>{alt || path}</>;
	const { src } = media;
	if (media.video) return <video controls preload="metadata" src={src} onError={() => setFailed(true)} className="max-h-[60vh] max-w-full rounded-md bg-black" />;
	return (
		<img
			src={src}
			alt={alt}
			loading="lazy"
			onError={() => setFailed(true)}
			onClick={openFile && (() => openFile(media.target))}
			className="max-h-[60vh] max-w-full cursor-zoom-in"
		/>
	);
}

/** One file of a {@link MediaStrip}: a thumbnail, a video's first frame with a play mark, that opens large. */
function Thumbnail({ media, onOpen, onFailed }: { media: Media; onOpen: (() => void) | undefined; onFailed: () => void }) {
	return (
		<button
			type="button"
			title={media.target.path}
			aria-label={`Open ${media.name}`}
			disabled={!onOpen}
			onClick={onOpen}
			className="relative cursor-zoom-in overflow-hidden rounded-md outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
		>
			{media.video ? (
				<>
					<video muted preload="metadata" src={media.src} onError={onFailed} className="h-32 max-w-60 bg-black object-contain" />
					<Play aria-hidden className="absolute inset-0 m-auto size-8 rounded-full bg-black/60 p-2 text-white" />
				</>
			) : (
				<img src={media.src} alt={media.name} loading="lazy" onError={onFailed} className="h-32 max-w-60 object-contain" />
			)}
		</button>
	);
}

/**
 * The images and videos a message names, in the order it names them, as thumbnails under its text. An image opens
 * large with ←/→ to the strip's other images; a video opens in the file dialog. A file that loads nothing drops out.
 */
export function MediaStrip({ paths }: { paths: string[] }) {
	const base = useContext(FileBaseContext);
	const openFile = useContext(DashboardActionsContext)?.openFile;
	const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
	const [shown, setShown] = useState<string | null>(null);
	const media = paths.flatMap(path => {
		const item = failed.has(path) ? null : mediaOf(path, base);
		return item ? [{ path, ...item }] : [];
	});
	const images = media.filter(item => !item.video);
	const index = images.findIndex(item => item.path === shown);
	const image = images[index];
	return (
		<>
			<figure className="mt-2 flex flex-wrap gap-1.5 empty:hidden" aria-label="Images and videos this message names">
				{media.map(item => (
					<Thumbnail
						key={item.path}
						media={item}
						onOpen={item.video ? openFile && (() => openFile(item.target)) : () => setShown(item.path)}
						onFailed={() => setFailed(current => new Set(current).add(item.path))}
					/>
				))}
			</figure>
			{image && (
				<ImageViewer
					src={mediaFileUrl(image.target)}
					caption={image.name}
					detail={image.target.path}
					index={index}
					count={images.length}
					previousLabel="Previous image"
					nextLabel="Next image"
					onIndex={next => setShown(images[next]!.path)}
					onClose={() => setShown(null)}
				/>
			)}
		</>
	);
}
