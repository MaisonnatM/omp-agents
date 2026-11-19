/**
 * omp-agents bookmarks in a session: the `bookmarks` tool, which searches the user's Zen bookmarks, read from Zen's
 * profile at each call, and the x.com posts they bookmarked, as the dashboard's last X sync kept them. The dashboard
 * loads it with `omp -e` into every session it starts, with the flag that names the X sync's file.
 */
import { homedir } from "node:os";
import { type BookmarkSearch, bookmarkLine, DEFAULT_SEARCH_LIMIT, searchBookmarks } from "../bookmarks/search";
import { readBookmarks } from "../bookmarks/store";
import { zenDir, zenProfileDir } from "../bookmarks/zen";
import { type ExtensionApi, type ExtensionTool, flagValue, reply } from "./extension-kit";

/** The flag that names the file the dashboard's X sync keeps the x.com bookmarks in. */
export const BOOKMARKS_FLAGS = { xFile: "omp-agents-bookmarks-x-file" } as const;

const MAX_LIMIT = 200;

const DESCRIPTION = [
	"Searches the user's bookmarks: their Zen browser bookmarks, with each one's folder, and the x.com posts they bookmarked, with each post's text and author.",
	"Every word of `query` must appear in a bookmark's title, URL, folder, text, or author, ignoring case; leave it out to list the newest.",
	`Returns one line per bookmark, newest first, at most \`limit\` (default ${DEFAULT_SEARCH_LIMIT}): the day it was bookmarked (for a post, the day it was posted), [zen] or [x], its folder or author, its title or text, and its URL.`,
	"The x.com bookmarks are those of the last sync on the dashboard's Memory page; say so when none show.",
].join("\n");

function bookmarksTool(pi: ExtensionApi): ExtensionTool<BookmarkSearch> {
	const { Type } = pi.typebox;
	return {
		name: "bookmarks",
		label: "Bookmarks",
		description: DESCRIPTION,
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Words every match holds, such as `figma plugin`." })),
			source: Type.Optional(Type.Union([Type.Literal("zen"), Type.Literal("x")], { description: "Only Zen's bookmarks or only the x.com posts." })),
			limit: Type.Optional(Type.Integer({ description: `How many to return, newest first; ${DEFAULT_SEARCH_LIMIT} when left out.`, minimum: 1, maximum: MAX_LIMIT })),
		}),
		loadMode: "essential",
		approval: "read",
		async execute(_toolCallId, params) {
			const xFile = flagValue(pi, BOOKMARKS_FLAGS.xFile);
			const profile = zenProfileDir(zenDir(homedir()));
			const { bookmarks, zenFound, x } = readBookmarks(profile, xFile);
			const found = searchBookmarks(bookmarks, params);
			const notes = [
				...(zenFound ? [] : ["Zen's profile was not found, so no Zen bookmark is searched."]),
				...(xFile === null ? ["The dashboard did not name the X sync's file, so no x.com bookmark is searched."] : []),
				...(xFile !== null && params.source !== "zen" && x.synced === null ? ["The x.com bookmarks were never synced; the user syncs them on the dashboard's Memory page."] : []),
			];
			const lines = found.length > 0 ? found.map(bookmarkLine) : ["No bookmark matches."];
			return reply([...notes, ...lines].join("\n"));
		},
	};
}

export default function bookmarksExtension(pi: ExtensionApi): void {
	pi.registerFlag(BOOKMARKS_FLAGS.xFile, { type: "string", description: "The file the omp-agents dashboard keeps the x.com bookmarks in, which the bookmarks tool searches." });
	pi.registerTool(bookmarksTool(pi));
}
