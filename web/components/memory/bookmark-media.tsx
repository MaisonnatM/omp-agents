/** An x.com post's photos, videos, and GIFs: images straight from X's `pbs.twimg.com`, which the page's Content Security Policy allows, and videos through `GET /api/bookmarks/x-video`, since X refuses them to another site's page. */
import { IconPlay } from "central-icons";
import type { XMedia } from "../../../src/shared/memory-page";
import { cn } from "@/lib/utils";
import { mediaSrc } from "../../api";

/** X's size names for a `pbs.twimg.com` image: `thumb` is a 150-pixel square, `orig` the upload. */
const sized = (url: string, name: "thumb" | "orig"): string => `${url}?name=${name}`;

/** A list row's 40-pixel preview of a post's first media, with a play mark on a video or GIF. */
export function MediaThumb({ media }: { media: XMedia }) {
	return (
		<span className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-surface-5">
			<img src={sized(media.url, "thumb")} alt="" loading="lazy" className="size-full object-cover" />
			{media.kind !== "photo" && (
				<span className="absolute inset-0 flex items-center justify-center bg-black/25">
					<IconPlay aria-hidden className="size-3.5 text-white" />
				</span>
			)}
		</span>
	);
}

function MediaItem({ media, fill }: { media: XMedia; fill: boolean }) {
	const fit = fill ? "size-full object-cover" : "max-h-[480px] w-full object-contain";
	if (media.video !== null) {
		const gif = media.kind === "gif";
		return (
			<video
				src={mediaSrc(`/api/bookmarks/x-video?url=${encodeURIComponent(media.video)}`)}
				poster={media.url}
				width={media.width || undefined}
				height={media.height || undefined}
				aria-label={media.alt ?? (gif ? "GIF" : "Video")}
				controls={!gif}
				autoPlay={gif}
				loop={gif}
				muted={gif}
				playsInline
				preload="metadata"
				className={cn("block bg-black", fit)}
			/>
		);
	}
	return (
		<a href={sized(media.url, "orig")} target="_blank" rel="noopener noreferrer" className="block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
			<img src={media.url} alt={media.alt ?? ""} width={media.width || undefined} height={media.height || undefined} loading="lazy" className={cn("block", fit)} />
		</a>
	);
}

/** The reader's media: one item at its own shape up to a height, or two to four in a grid of cropped tiles, a photo opening full size in a new tab. */
export function PostMedia({ media }: { media: readonly XMedia[] }) {
	const [first] = media;
	if (first === undefined) return null;
	if (media.length === 1) {
		return (
			<div className="overflow-hidden rounded-xl border border-border bg-surface-5">
				<MediaItem media={first} fill={false} />
			</div>
		);
	}
	return (
		<div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-border bg-surface-5">
			{media.map((item, at) => (
				<div key={item.url} className={cn("aspect-square", media.length === 3 && at === 0 && "col-span-2 aspect-[2/1]")}>
					<MediaItem media={item} fill />
				</div>
			))}
		</div>
	);
}
