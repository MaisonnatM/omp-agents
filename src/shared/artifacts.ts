/** Saved artifact records and the content-addressed names shared by the transcript, page, and server. */
import { isNonEmpty, isObject, isSafeInteger } from "../json";

export const ARTIFACT_KINDS = ["html", "markdown", "svg"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** A lowercase hex SHA-256, made only at the artifact record or version-name boundary. */
export type Sha256 = string & { readonly __brand: "Sha256" };
export type VersionName = `${Sha256}.${ArtifactKind}`;
export const ARTIFACT_VERSIONS_DIR = "artifact-versions";

/** The details of one successful artifact tool result. */
export interface ArtifactSave {
	/** The artifact's identity, a slash-separated path under the session's local root. */
	file: string;
	kind: ArtifactKind;
	title: string;
	note: string | null;
	sha256: Sha256;
	bytes: number;
	/** When the tool saved this version, in ms since the epoch. */
	savedAt: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const isKind = (value: unknown): value is ArtifactKind => ARTIFACT_KINDS.includes(value as ArtifactKind);

/** A slash-separated path that stays under the session's local root: no empty, `.`, or `..` part, no backslash, NUL, or drive letter. */
function isLocalFile(file: unknown): file is string {
	return isNonEmpty(file) && !file.includes("\\") && !file.includes("\0") && !/^[A-Za-z]:/.test(file) && file.split("/").every(part => part && part !== "." && part !== "..");
}

/** A version's note: one trimmed line of at most 120 characters, or null for none. */
function isNote(note: unknown): note is string | null {
	return note === null || (typeof note === "string" && note.length > 0 && note === note.trim() && note.length <= 120 && !/[\r\n]/.test(note));
}

export function parseArtifactSave(details: unknown): ArtifactSave | null {
	if (!isObject(details)) return null;
	const { file, kind, title, note, sha256, bytes, savedAt } = details;
	if (!isLocalFile(file) || !isKind(kind) || !isNonEmpty(title) || !isNote(note)) return null;
	if (typeof sha256 !== "string" || !SHA256.test(sha256) || !isSafeInteger(bytes) || bytes <= 0 || !isSafeInteger(savedAt) || savedAt <= 0) return null;
	return { file, kind, title, note, sha256: sha256 as Sha256, bytes, savedAt };
}

export const versionName = (save: Pick<ArtifactSave, "sha256" | "kind">): VersionName => `${save.sha256}.${save.kind}`;

export function parseVersionName(raw: string): { sha256: Sha256; kind: ArtifactKind } | null {
	const [sha256, kind, ...extra] = raw.split(".");
	return sha256 && SHA256.test(sha256) && isKind(kind) && extra.length === 0 ? { sha256: sha256 as Sha256, kind } : null;
}

/** The `postMessage` type the Artifacts tab's frame of an HTML artifact sends when one of its inline images is clicked. */
export const ARTIFACT_IMAGES_MESSAGE = "omp-artifact-images";

/** The inline images of an HTML artifact, in page order, and the clicked one's place among them. */
export interface ArtifactImages {
	images: { src: string; caption: string }[];
	index: number;
}

/**
 * A frame's message as `ArtifactImages`, or null. The page is the agent's, so only `data:image/` sources pass: the
 * dashboard, whose `img-src` allows them, never loads an address the page chose.
 */
export function parseArtifactImages(data: unknown): ArtifactImages | null {
	if (!isObject(data) || data.type !== ARTIFACT_IMAGES_MESSAGE || !Array.isArray(data.images)) return null;
	const images: ArtifactImages["images"] = [];
	for (const image of data.images as unknown[]) {
		if (!isObject(image) || typeof image.src !== "string" || !image.src.startsWith("data:image/")) return null;
		images.push({ src: image.src, caption: typeof image.alt === "string" && image.alt.trim() ? image.alt.trim() : "Image" });
	}
	const { index } = data;
	return isSafeInteger(index) && index >= 0 && index < images.length ? { images, index } : null;
}
