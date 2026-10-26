/** The images and videos on this computer that agent text names, shown in the message and opened large in the file dialog. */
import { Play } from "lucide-react";
import { useContext, useState } from "react";
import { mediaUrl } from "../../src/shared/transcript";
import { mediaSrc } from "../api";
import { absoluteFilePath, linkedFile } from "../file-paths";
import { DashboardActionsContext } from "./dashboard-context";
import { FileBaseContext } from "./file-link";

/** The absolute path of `path` against the message's base, and whether it plays as a video; `null` when nothing resolves it or it is no media file. */
function useMedia(path: string): { target: string; video: boolean } | null {
	const base = useContext(FileBaseContext);
	const file = linkedFile(path);
	const target = absoluteFilePath(path, base);
	if (!file || file.kind === "text" || target === null) return null;
	return { target, video: file.kind === "video" };
}

/** An image of agent text, `![alt](path)`, in place: an image, or a video that plays there. A path that loads nothing shows its `alt`. */
export function LocalMedia({ path, alt }: { path: string; alt: string }) {
	const media = useMedia(path);
	const openFile = useContext(DashboardActionsContext)?.openFile;
	const [failed, setFailed] = useState(false);
	if (media === null || failed) return <>{alt || path}</>;
	const src = mediaSrc(mediaUrl(media.target));
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

/** One file of a {@link MediaStrip}: a thumbnail, a video's first frame with a play mark, that opens large. A file that loads nothing drops out. */
function Thumbnail({ path }: { path: string }) {
	const media = useMedia(path);
	const openFile = useContext(DashboardActionsContext)?.openFile;
	const [failed, setFailed] = useState(false);
	if (media === null || failed) return null;
	const src = mediaSrc(mediaUrl(media.target));
	const name = media.target.slice(media.target.lastIndexOf("/") + 1);
	return (
		<button
			type="button"
			title={media.target}
			aria-label={`Open ${name}`}
			disabled={!openFile}
			onClick={() => openFile?.(media.target)}
			className="relative cursor-zoom-in overflow-hidden rounded-md outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
		>
			{media.video ? (
				<>
					<video muted preload="metadata" src={src} onError={() => setFailed(true)} className="h-32 max-w-60 bg-black object-contain" />
					<Play aria-hidden className="absolute inset-0 m-auto size-8 rounded-full bg-black/60 p-2 text-white" />
				</>
			) : (
				<img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="h-32 max-w-60 object-contain" />
			)}
		</button>
	);
}

/** The images and videos a message names, in the order it names them, as thumbnails under its text. */
export function MediaStrip({ paths }: { paths: string[] }) {
	return (
		<figure className="mt-2 flex flex-wrap gap-1.5 empty:hidden" aria-label="Images and videos this message names">
			{paths.map(path => (
				<Thumbnail key={path} path={path} />
			))}
		</figure>
	);
}
