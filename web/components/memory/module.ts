/** The Memory module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/usage/memory.md. */
import { IconBrain } from "central-icons";
import type { PageModule } from "../../modules";

/** The Memory page's tab: one repository's project memory (`null` for the one the page picks), one repository's glossary (`null` for the first), or the bookmarks narrowed by search `q`. */
export type MemoryRoute = { tab: "project"; repo: string | null } | { tab: "glossary"; repo: string | null } | { tab: "bookmarks"; q: string };

export type MemoryControlId =
	| "memory.tab.project"
	| "memory.tab.bookmarks"
	| "memory.tab.glossary"
	| "memory.project.repo"
	| "memory.project.open"
	| "memory.project.add"
	| "memory.project.save"
	| "memory.project.delete"
	| "memory.glossary.repo"
	| "memory.glossary.open"
	| "memory.bookmarks.folder"
	| "memory.bookmarks.open"
	| "memory.bookmarks.sync";

type MemoryShortcutId =
	| "memoryProjectNext"
	| "memoryProjectPrevious"
	| "memoryProjectClose"
	| "memoryGlossaryNext"
	| "memoryGlossaryPrevious"
	| "memoryGlossaryClose"
	| "memoryBookmarksNext"
	| "memoryBookmarksPrevious"
	| "memoryBookmarksClose";

export const MEMORY_PAGE: PageModule<"memory", MemoryRoute, MemoryShortcutId, MemoryControlId> = {
	id: "memory",
	tab: { label: "Memory", icon: IconBrain, place: 70 },
	about: "What your projects remember, the words their glossaries define, and your Zen and x.com bookmarks, which agents can search.",
	home: { tab: "project", repo: null },
	/** `#memory` is the project memory with `?repo=<root>` that repository's (`#memory/project` too, from older links), `#memory/glossary` the glossary with `?repo=<root>` that repository's, and `#memory/bookmarks` the bookmarks with `?q=<search>` a search. */
	address: {
		parse(rest, query) {
			if (rest === "bookmarks") return { tab: "bookmarks", q: query.get("q") ?? "" };
			if (rest === "glossary") return { tab: "glossary", repo: query.get("repo") || null };
			return { tab: "project", repo: query.get("repo") || null };
		},
		rest: route => (route.tab === "project" ? null : route.tab),
		query(route) {
			if (route.tab === "bookmarks") return route.q === "" ? null : `q=${encodeURIComponent(route.q)}`;
			return route.repo === null ? null : `repo=${encodeURIComponent(route.repo)}`;
		},
	},
	title: () => "Memory",
	views: [
		{ key: "memory", label: "Project memory" },
		{ key: "memory/glossary", label: "Glossary" },
		{ key: "memory/bookmarks", label: "Bookmarks" },
	],
	view: route => (route.tab === "project" ? "memory" : `memory/${route.tab}`),
	shortcuts: {
		category: "Memory",
		goTo: { label: "Go to your memory and bookmarks", command: "Go to memory", keys: [] },
		rows: [
			{
				id: "memoryProjectNext",
				label: "Project memory: focus the next memory, or open it while a memory is open",
				keys: [
					{ chord: { key: "ArrowDown" }, scope: "outside-fields" },
					{ chord: { key: "j" }, scope: "outside-fields" },
				],
			},
			{
				id: "memoryProjectPrevious",
				label: "Project memory: focus the previous memory, or open it while a memory is open",
				keys: [
					{ chord: { key: "ArrowUp" }, scope: "outside-fields" },
					{ chord: { key: "k" }, scope: "outside-fields" },
				],
			},
			{ id: "memoryProjectClose", label: "Project memory: close the open memory", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
			{
				id: "memoryGlossaryNext",
				label: "Glossary: focus the next term, or open it while a term is open",
				keys: [
					{ chord: { key: "ArrowDown" }, scope: "outside-fields" },
					{ chord: { key: "j" }, scope: "outside-fields" },
				],
			},
			{
				id: "memoryGlossaryPrevious",
				label: "Glossary: focus the previous term, or open it while a term is open",
				keys: [
					{ chord: { key: "ArrowUp" }, scope: "outside-fields" },
					{ chord: { key: "k" }, scope: "outside-fields" },
				],
			},
			{ id: "memoryGlossaryClose", label: "Glossary: close the open term", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
			{
				id: "memoryBookmarksNext",
				label: "Bookmarks: focus the next bookmark, or open it while a bookmark is open",
				keys: [
					{ chord: { key: "ArrowDown" }, scope: "outside-fields" },
					{ chord: { key: "j" }, scope: "outside-fields" },
				],
			},
			{
				id: "memoryBookmarksPrevious",
				label: "Bookmarks: focus the previous bookmark, or open it while a bookmark is open",
				keys: [
					{ chord: { key: "ArrowUp" }, scope: "outside-fields" },
					{ chord: { key: "k" }, scope: "outside-fields" },
				],
			},
			{ id: "memoryBookmarksClose", label: "Bookmarks: close the open bookmark", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
		],
	},
	controls: [
		{ id: "memory.tab.project", label: "Memory Project memory tab", area: "Memory" },
		{ id: "memory.tab.glossary", label: "Memory Glossary tab", area: "Memory" },
		{ id: "memory.tab.bookmarks", label: "Memory Bookmarks tab", area: "Memory" },
		{ id: "memory.project.repo", label: "Project memory repository picker", area: "Memory" },
		{ id: "memory.project.open", label: "Project memory row", area: "Memory" },
		{ id: "memory.project.add", label: "Project memory New memory button", area: "Memory" },
		{ id: "memory.project.save", label: "Project memory Save button", area: "Memory" },
		{ id: "memory.project.delete", label: "Project memory Delete button", area: "Memory" },
		{ id: "memory.glossary.repo", label: "Glossary repository picker", area: "Memory" },
		{ id: "memory.glossary.open", label: "Glossary term row", area: "Memory" },
		{ id: "memory.bookmarks.folder", label: "Bookmarks folder tree row and folder picker", area: "Memory" },
		{ id: "memory.bookmarks.open", label: "Bookmark reader Open link", area: "Memory" },
		{ id: "memory.bookmarks.sync", label: "Bookmarks Sync x.com button", area: "Memory" },
	],
	listsItself: true,
};
