/** Which page has a list of its own, and where that list goes: a column at the page's left, or under its row in the sidebar. */
import { isModulePage, moduleOf } from "./modules";
import type { Page } from "./routing";
import type { NavRow } from "./sidebar-tabs";

/** The rows with no list of their own: the Pull requests page lists its repositories itself, and New session and Notifications have none. */
const NO_LIST = ["new", "notifications", "pull-requests"] as const satisfies readonly NavRow[];

/** A page whose sidebar row holds a list of its own: every other tab's page and Settings; the Sessions panes have the roster instead. */
export type ListPage = Extract<Page, { kind: Exclude<NavRow, (typeof NO_LIST)[number]> }>;

/** Whether `page` is the page of `row`, a row with a list of its own. */
const listsOwnPage = (page: Page, row: NavRow): page is ListPage => page.kind === row && !NO_LIST.some(other => other === row);

/** Narrowest and widest the column gets, in px, and its width until the user drags it. */
export const COLUMN_MIN = 192;
export const COLUMN_MAX = 400;
export const COLUMN_DEFAULT = 256;

/** Narrowest the page beside the column gets, in px: the sidebar's own floor for a pane. */
const PAGE_MIN = 480;
/** Narrowest a page that splits its list from its open item gets, the width at which `ListSplit` shows both side by side. */
const SPLIT_PAGE_MIN = 768;
const SPLIT_PAGES: Partial<Record<ListPage["kind"], true>> = { todo: true };

/** The page `row` lists, `null` when the row has no list of its own or `page` is not its page. */
export function listPageOf(page: Page | null, row: NavRow | null): ListPage | null {
	return page !== null && row !== null && listsOwnPage(page, row) ? page : null;
}

/**
 * Where `page`'s list goes and how wide the column may get. A floating sidebar, as on a phone, and a page area too narrow
 * to give the page its floor beside the narrowest column, nest the list under its row; otherwise the column holds it, up
 * to what leaves the page its floor.
 */
export function listPlacement(page: ListPage, floating: boolean, room: number): { at: "sidebar" } | { at: "column"; max: number } {
	const split = isModulePage(page) ? moduleOf(page).split : SPLIT_PAGES[page.kind];
	const max = Math.min(COLUMN_MAX, room - (split ? SPLIT_PAGE_MIN : PAGE_MIN));
	return floating || max < COLUMN_MIN ? { at: "sidebar" } : { at: "column", max };
}
