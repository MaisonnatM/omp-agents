/** The images the Board's composers attach: saved as files, since the Board's log keeps text only, and named in the text by path. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseImages } from "../shared/sessions";
import { checked } from "./http";
import type { RouteKit, Routes } from "./route-kit";

const EXTENSIONS: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** `PUT /api/board/images`: `{ images }` saved in `dir` under their content's hash; answers `{ paths }`, one per image, in order. */
export function boardImageRoutes({ write }: RouteKit, dir: string): Routes {
	const save = write(
		body => checked(parseImages((body as { images?: unknown } | null)?.images), "Expected { images } of PNG, JPEG, GIF, or WebP images in base64"),
		async images => {
			await mkdir(dir, { recursive: true });
			const paths = await Promise.all(
				images.map(async ({ data, mimeType }) => {
					const bytes = Buffer.from(data, "base64");
					const path = join(dir, `${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}.${EXTENSIONS[mimeType]}`);
					await writeFile(path, bytes);
					return path;
				}),
			);
			return { paths };
		},
	);
	return { "/api/board/images": { PUT: save } };
}
