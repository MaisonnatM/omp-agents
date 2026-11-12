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

export function parseArtifactSave(details: unknown): ArtifactSave | null {
	if (!isObject(details)) return null;
	const { file, kind, title, note, sha256, bytes, savedAt } = details;
	if (!isNonEmpty(file) || file.includes("\\") || file.includes("\0") || file.split("/").some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(file)) return null;
	if (!isKind(kind) || !isNonEmpty(title) || typeof sha256 !== "string" || !SHA256.test(sha256) || !isSafeInteger(bytes) || bytes <= 0 || !isSafeInteger(savedAt) || savedAt <= 0) return null;
	if (note !== null && (typeof note !== "string" || !note.trim() || note !== note.trim() || note.length > 120 || /[\r\n]/.test(note))) return null;
	return { file, kind, title, note, sha256: sha256 as Sha256, bytes, savedAt };
}

export const versionName = (save: Pick<ArtifactSave, "sha256" | "kind">): VersionName => `${save.sha256}.${save.kind}`;

export function parseVersionName(raw: string): { sha256: Sha256; kind: ArtifactKind } | null {
	const [sha256, kind, ...extra] = raw.split(".");
	return sha256 && SHA256.test(sha256) && isKind(kind) && extra.length === 0 ? { sha256: sha256 as Sha256, kind } : null;
}
