/** The Memory page's data: every workspace repository's project memory, and the bookmarks from Zen and x.com that agents can search. */

export const PROJECT_MEMORY_KINDS = ["decision", "fact", "lesson"] as const;
export type ProjectMemoryKind = (typeof PROJECT_MEMORY_KINDS)[number];

/** One project memory, as the `project_memory` tool stores it under `refs/omp/memory`. */
export interface ProjectMemoryEntry {
	slug: string;
	kind: ProjectMemoryKind;
	/** One self-contained line, at most 120 characters. */
	line: string;
	/** The detail, at most 2000 characters. */
	body: string;
	/** `#<session id>` of the session that last added or updated it, or `#dashboard` for an edit from this page. */
	source: string;
	/** `YYYY-MM-DD` of that change. */
	updated: string;
}

/** One git repository among the workspaces, with its memories, newest `updated` first. */
export interface ProjectMemoryRepo {
	/** The repository's top-level directory, absolute; the key an edit names. */
	root: string;
	/** `~/code/omp-agents`. */
	rootDisplay: string;
	/** The repository's folder name. */
	name: string;
	memories: ProjectMemoryEntry[];
}

/** `GET /api/project-memory`: every workspace repository, those with memories first, then by name. */
export interface ProjectMemoryView {
	repos: ProjectMemoryRepo[];
}

/** One change, as the `project_memory` tool's `ops` take it; `kind`, `line`, and `body` are required for `add`. */
export interface ProjectMemoryOp {
	op: "add" | "update" | "delete";
	slug: string;
	kind?: ProjectMemoryKind;
	line?: string;
	body?: string;
}

/** `PUT /api/project-memory`: applies `ops` to `root`'s memory all or nothing; answered with the whole view, or 400 with the refusal reasons. */
export interface ProjectMemoryEdit {
	root: string;
	ops: ProjectMemoryOp[];
}

export const BOOKMARK_SOURCES = ["zen", "x"] as const;
export type BookmarkSource = (typeof BOOKMARK_SOURCES)[number];

/** One bookmark: a Zen browser bookmark, or an x.com post you bookmarked. */
export interface Bookmark {
	/** `zen:<guid>` or `x:<post id>`. */
	id: string;
	source: BookmarkSource;
	url: string;
	/** The page title, or for a post its author's display name. */
	title: string;
	/** Zen's folder path, such as `Toolbar / Design`; `null` for a post. */
	folder: string | null;
	/** A post's text; `null` for a Zen bookmark. */
	text: string | null;
	/** A post's `@handle`; `null` for a Zen bookmark. */
	author: string | null;
	/** ISO time it was bookmarked, or for a post when it was posted, since X does not say when you bookmarked it. */
	addedAt: string;
}

/** How the x.com bookmarks were last read, through the cookies of your signed-in Zen session. */
export interface XSyncState {
	/** ISO time of the last sync that succeeded; `null` before the first. */
	syncedAt: string | null;
	/** Why the last sync failed, in words for the page; `null` when it succeeded or never ran. */
	error: string | null;
	/** Zen holds an x.com sign-in. */
	signedIn: boolean;
}

/** `GET /api/bookmarks`, and `POST /api/bookmarks/x-sync`, which first reads the x.com bookmarks again: every bookmark, newest first. */
export interface BookmarksView {
	bookmarks: Bookmark[];
	/** Zen's profile was found and read; `false` hides nothing but says why no Zen bookmark shows. */
	zenFound: boolean;
	x: XSyncState;
}
