/** The Sport page's demo thumbnails, fetched once from YouTube and kept on disk, so the page's `img-src` stays `'self'`. */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fail } from "./http";
import type { RouteKit, Routes } from "./route-kit";

/** A YouTube video id: 11 characters of base64url. */
const VIDEO_ID = /^[\w-]{11}$/;

const IMAGE_HEADERS = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" };

export interface SportThumbsEnv {
	/** Where each thumbnail is kept as `<id>.jpg`. */
	dir: string;
	/** Reads YouTube's image server. */
	fetch: (url: string) => Promise<Response>;
}

export function sportThumbRoutes({ media }: RouteKit, env: SportThumbsEnv): Routes {
	/** `GET /api/sport/thumb?id=<video id>`: the video's `hqdefault.jpg`, from the disk once fetched; 404 when YouTube has none, as for a video taken down. */
	const thumb = media(async params => {
		const id = params.get("id") ?? "";
		if (!VIDEO_ID.test(id)) return fail(400, "Expected ?id= an 11-character YouTube video id");
		const kept = Bun.file(join(env.dir, `${id}.jpg`));
		if (await kept.exists()) return new Response(kept, { headers: IMAGE_HEADERS });
		const fetched = await env.fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`).catch(() => null);
		if (!fetched) return fail(502, "YouTube's image server did not answer");
		if (!fetched.ok) return fail(404, "YouTube has no thumbnail for this video");
		const bytes = new Uint8Array(await fetched.arrayBuffer());
		await mkdir(env.dir, { recursive: true });
		const partial = join(env.dir, `${id}.${crypto.randomUUID()}.part`);
		await writeFile(partial, bytes);
		await rename(partial, kept.name!);
		return new Response(bytes, { headers: IMAGE_HEADERS });
	});
	return { "/api/sport/thumb": { GET: thumb } };
}
