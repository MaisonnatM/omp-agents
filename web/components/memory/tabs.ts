/** The Memory page's three tabs and their addresses. */
import { hashForPage } from "../../routing";
import type { MemoryControlId, MemoryRoute } from "./module";

/** The address of the Memory page at `route`. */
export const memoryHash = (route: MemoryRoute): string => hashForPage({ kind: "memory", ...route });

/** The tabs the page's header lists; `control` tags each. */
export const MEMORY_TABS = [
	{ route: { tab: "omp" }, name: "omp memory", control: "memory.tab.omp" },
	{ route: { tab: "project", repo: null }, name: "Project memory", control: "memory.tab.project" },
	{ route: { tab: "bookmarks", q: "" }, name: "Bookmarks", control: "memory.tab.bookmarks" },
] as const satisfies readonly { route: MemoryRoute; name: string; control: MemoryControlId }[];
