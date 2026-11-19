/** The Memory module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/usage/memory.md. */
import { IconBrain } from "central-icons";
import type { PageModule } from "../../modules";

/** The Memory page's tab: omp memory, one repository's project memory (`null` for the one the page picks), or the bookmarks narrowed by search `q`. */
export type MemoryRoute = { tab: "omp" } | { tab: "project"; repo: string | null } | { tab: "bookmarks"; q: string };

export type MemoryControlId =
	| "memory.tab.omp"
	| "memory.tab.project"
	| "memory.tab.bookmarks"
	| "memory.project.repo"
	| "memory.project.open"
	| "memory.project.add"
	| "memory.project.save"
	| "memory.project.delete"
	| "memory.bookmarks.source"
	| "memory.bookmarks.open"
	| "memory.bookmarks.sync";

export const MEMORY_PAGE: PageModule<"memory", MemoryRoute, never, MemoryControlId> = {
	id: "memory",
	tab: { label: "Memory", icon: IconBrain, place: 70 },
	about: "What omp and your projects remember, and your Zen and x.com bookmarks, which agents can search.",
	home: { tab: "omp" },
	/** `#memory` is omp memory, `#memory/project` the project memory with `?repo=<root>` that repository's, and `#memory/bookmarks` the bookmarks with `?q=<search>` a search. */
	address: {
		parse(rest, query) {
			if (rest === "project") return { tab: "project", repo: query.get("repo") || null };
			if (rest === "bookmarks") return { tab: "bookmarks", q: query.get("q") ?? "" };
			return { tab: "omp" };
		},
		rest: route => (route.tab === "omp" ? null : route.tab),
		query(route) {
			if (route.tab === "project") return route.repo === null ? null : `repo=${encodeURIComponent(route.repo)}`;
			return route.tab === "bookmarks" && route.q !== "" ? `q=${encodeURIComponent(route.q)}` : null;
		},
	},
	title: () => "Memory",
	views: [
		{ key: "memory", label: "omp memory" },
		{ key: "memory/project", label: "Project memory" },
		{ key: "memory/bookmarks", label: "Bookmarks" },
	],
	view: route => (route.tab === "omp" ? "memory" : `memory/${route.tab}`),
	shortcuts: {
		category: "Memory",
		goTo: { label: "Go to your memory and bookmarks", command: "Go to memory", keys: [] },
		rows: [],
	},
	controls: [
		{ id: "memory.tab.omp", label: "Memory omp memory tab", area: "Memory" },
		{ id: "memory.tab.project", label: "Memory Project memory tab", area: "Memory" },
		{ id: "memory.tab.bookmarks", label: "Memory Bookmarks tab", area: "Memory" },
		{ id: "memory.project.repo", label: "Project memory repository picker", area: "Memory" },
		{ id: "memory.project.open", label: "Project memory row", area: "Memory" },
		{ id: "memory.project.add", label: "Project memory New memory button", area: "Memory" },
		{ id: "memory.project.save", label: "Project memory Save button", area: "Memory" },
		{ id: "memory.project.delete", label: "Project memory Delete button", area: "Memory" },
		{ id: "memory.bookmarks.source", label: "Bookmarks All, Zen, and x.com tabs", area: "Memory" },
		{ id: "memory.bookmarks.open", label: "Bookmark row", area: "Memory" },
		{ id: "memory.bookmarks.sync", label: "Bookmarks Sync x.com button", area: "Memory" },
	],
	listsItself: true,
};
