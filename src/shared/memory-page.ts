/** The Memory page's data: every workspace repository's project memory, and the bookmarks from Zen and x.com that agents can search. */
import type { MemoryKind, RawOp } from "../../templates/omp/agent/extensions/project-memory/contract";
import { everyWord } from "./every-word";

/** The session name an edit from the Memory page records, so its memories' source reads `#dashboard`. */
export const DASHBOARD_SESSION = "dashboard";

/** One project memory, as the `project_memory` tool stores it under `refs/omp/memory`. */
export interface ProjectMemoryEntry {
	slug: string;
	kind: MemoryKind;
	/** One self-contained line, at most `LINE_MAX` characters. */
	line: string;
	/** The detail, at most `BODY_MAX` characters. */
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
	/** The text of the repository's `GLOSSARY.md`, the words its interface, docs, and code use; `null` when it has none. */
	glossary: string | null;
}

/** `GET /api/project-memory`: every workspace repository, those with memories first, then by name. */
export interface ProjectMemoryView {
	repos: ProjectMemoryRepo[];
}

/** `PUT /api/project-memory`: applies `ops`, the `project_memory` tool's own, to `root`'s memory all or nothing; answered with the whole view, or 400 with the refusal reasons. */
export interface ProjectMemoryEdit {
	root: string;
	ops: RawOp[];
}

/** One term of a repository's `GLOSSARY.md`. */
export interface GlossaryTerm {
	/** The term, as its bold heading writes it. */
	term: string;
	/** What it means, Markdown, one source line per line. */
	definition: string;
	/** The words its `_Avoid_:` line says not to use for it; none without that line. */
	avoid: string[];
}

/** A `##` heading of the glossary and its terms; `title` is `null` for the terms above every heading. */
export interface GlossarySection {
	title: string | null;
	terms: GlossaryTerm[];
}

/** One git repository among the workspaces with a `GLOSSARY.md`, as {@link ProjectMemoryRepo} names it. */
export interface GlossaryRepo {
	root: string;
	rootDisplay: string;
	name: string;
	sections: GlossarySection[];
}

/** `GET /api/glossary`: every workspace repository with a glossary, by folder name. */
export interface GlossaryView {
	repos: GlossaryRepo[];
}

/** A Zen browser bookmark. */
export interface ZenBookmark {
	source: "zen";
	/** `zen:<guid>`. */
	id: string;
	url: string;
	/** The page title, else its URL. */
	title: string;
	/** Zen's folders from its root down, such as `["Toolbar", "Design"]`; none outside every folder. */
	folder: string[];
	/** ISO time it was bookmarked. */
	addedAt: string;
}

/** An x.com post you bookmarked. */
export interface XBookmark {
	source: "x";
	/** `x:<post id>`. */
	id: string;
	url: string;
	/** Its author's display name. */
	name: string;
	/** Its author's `@handle`. */
	handle: string;
	text: string;
	/** The language X detected in its text, a BCP 47 code such as `fr`; `null` when X gave none. */
	lang: string | null;
	/** Its text in English, when it is in another language and the sync could translate it. */
	translation: string | null;
	/** Its photos, videos, and GIFs, in the post's order. */
	media: XMedia[];
	/** ISO time it was posted, since X does not say when you bookmarked it. */
	addedAt: string;
}

/** A photo, video, or GIF in an x.com post, served by X. */
export interface XMedia {
	kind: "photo" | "video" | "gif";
	/** The photo, or a video's or GIF's poster, on `pbs.twimg.com`. */
	url: string;
	width: number;
	height: number;
	/** A video's or GIF's MP4 of the highest bitrate, on `video.twimg.com`; `null` for a photo, or when X sent none. */
	video: string | null;
	/** The description its author wrote for screen readers. */
	alt: string | null;
}

export type Bookmark = ZenBookmark | XBookmark;
export type BookmarkSource = Bookmark["source"];

/** A test of whether a bookmark, from `source` when given, holds every word of `query` in any case: a page in its title, address, or folders, a post in its author, text, translation, or address. */
export function bookmarkMatcher(query: string, source?: BookmarkSource): (bookmark: Bookmark) => boolean {
	const matches = everyWord(query);
	return bookmark => {
		if (source !== undefined && bookmark.source !== source) return false;
		const fields = bookmark.source === "zen" ? [bookmark.title, bookmark.url, ...bookmark.folder] : [bookmark.name, bookmark.handle, bookmark.text, bookmark.translation ?? "", bookmark.url];
		return matches(fields.join("\n"));
	};
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
