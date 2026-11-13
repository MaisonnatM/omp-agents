/** The images and videos on this computer that agent text names, shown in the message and opened large. */
import { IconPlay } from "central-icons";
import { useContext, useState } from "react";
import { mediaSrc } from "../api";
import { type FileBase, type FileTarget, fileTarget, linkedFile, mediaFileUrl } from "../file-paths";
import { DashboardActionsContext } from "./dashboard-context";
import { FileBaseContext } from "./file-link";
import { Openable } from "./markdown-images";

interface Media {
	/** As the message writes it. */
	path: string;
	target: FileTarget;
	/** Its address before `mediaSrc`, which whatever draws it applies. */
	url: string;
	name: string;
	video: boolean;
}

/** The file `path` names against the message's `base`, its address, and whether it plays as a video; `null` when nothing resolves it or it is no media file. */
function mediaOf(path: string, base: FileBase | null): Media | null {
	const file = linkedFile(path);
	const target = fileTarget(path, base);
	if (!file || file.kind === "text" || target === null) return null;
	return { path, target, url: mediaFileUrl(target), name: target.path.slice(target.path.lastIndexOf("/") + 1), video: file.kind === "video" };
}

/** An image of agent text, `![alt](path)`, in place: an image that opens large, or a video that plays there. A path that loads nothing shows its `alt`. */
export function LocalMedia({ path, alt }: { path: string; alt: string }) {
	const media = mediaOf(path, useContext(FileBaseContext));
	const [failed, setFailed] = useState(false);
	if (media === null || failed) return <>{alt || path}</>;
	if (media.video) return <video controls preload="metadata" src={mediaSrc(media.url)} onError={() => setFailed(true)} className="max-h-[60vh] max-w-full rounded-md bg-black" />;
	return (
		<Openable src={media.url} alt={alt} detail={media.target.path}>
			<img src={mediaSrc(media.url)} alt={alt} loading="lazy" onError={() => setFailed(true)} className="max-h-[60vh] max-w-full" />
		</Openable>
	);
}

const THUMBNAIL = "relative cursor-zoom-in overflow-hidden rounded-md outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10";

/** One file of a {@link MediaStrip}: an image's thumbnail, which opens large, or a video's first frame with a play mark, which opens in the file dialog. */
function Thumbnail({ media, onFailed }: { media: Media; onFailed: () => void }) {
	const openFile = useContext(DashboardActionsContext)?.openFile;
	if (!media.video)
		return (
			<Openable src={media.url} alt={media.name} detail={media.target.path} title={media.target.path} className={THUMBNAIL}>
				<img src={mediaSrc(media.url)} alt={media.name} loading="lazy" onError={onFailed} className="h-32 max-w-60 object-contain" />
			</Openable>
		);
	return (
		<button type="button" title={media.target.path} aria-label={`Open ${media.name}`} disabled={!openFile} onClick={() => openFile?.(media.target)} className={THUMBNAIL}>
			<video muted preload="metadata" src={mediaSrc(media.url)} onError={onFailed} className="h-32 max-w-60 bg-black object-contain" />
			<IconPlay className="absolute inset-0 m-auto size-8 rounded-full bg-black/60 p-2 text-white" />
		</button>
	);
}

/**
 * The images and videos a message names, in the order it names them, as thumbnails under its text. An image opens
 * large with ←/→ to the message's other images; a video opens in the file dialog. A file that loads nothing drops out.
 */
export function MediaStrip({ paths }: { paths: string[] }) {
	const base = useContext(FileBaseContext);
	const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
	const media = paths.flatMap(path => {
		const item = failed.has(path) ? null : mediaOf(path, base);
		return item ? [item] : [];
	});
	return (
		<figure className="mt-2 flex flex-wrap gap-1.5 empty:hidden" aria-label="Images and videos this message names">
			{media.map(item => (
				<Thumbnail key={item.path} media={item} onFailed={() => setFailed(current => new Set(current).add(item.path))} />
			))}
		</figure>
	);
}
