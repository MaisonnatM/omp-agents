/** A bookmarked post's video, relayed from X, which refuses `video.twimg.com` to a player whose page sends another site as `Referer`. See docs/architecture/memory-page.md. */
import type { Fetch } from "./x-sync";

const VIDEO_HOST = "https://video.twimg.com/";
/** The headers a player needs to seek through the relayed video. */
const KEPT = ["content-type", "content-length", "content-range", "accept-ranges"];

/** `GET /api/bookmarks/x-video?url=<MP4 on video.twimg.com>`: the video, or the `Range` of it the player asks, as X answers it; 404 for another host, 502 when X does not answer. */
export async function readXVideo(fetch: Fetch, url: string | null, range: string | null): Promise<Response> {
	if (!url?.startsWith(VIDEO_HOST)) return new Response(null, { status: 404 });
	let answer: Response;
	try {
		answer = await fetch(url, range ? { headers: { range } } : undefined);
	} catch {
		return new Response(null, { status: 502 });
	}
	const headers = new Headers({ "Cache-Control": "private, max-age=86400" });
	for (const name of KEPT) {
		const value = answer.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(answer.body, { status: answer.status, headers });
}
