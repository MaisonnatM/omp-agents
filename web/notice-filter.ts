/** What the Notifications page's bar keeps and shows: its tab, its **Filter**, its search, and its **Display** grouping. */
import type { Notice } from "../src/shared/notices";
import { isObject, isTexts, oneOf, parseJson } from "../src/json";
import { everyWord } from "../src/shared/every-word";
import { type DayRange, type FilterOption, type GroupingDisplay, groupingDisplay, isDayRange, withinLast } from "./list-filter";
import { type NoticeSource, presentNotice } from "./notice-model";

/** Every source, in menu and group order. */
export const NOTICE_SOURCES = ["github", "slack", "providers", "integrations", "calendar", "sessions", "updates"] as const satisfies readonly NoticeSource[];

export const SOURCE_LABELS: Record<NoticeSource, string> = {
	github: "GitHub",
	slack: "Slack",
	providers: "Providers",
	integrations: "Integrations",
	calendar: "Calendar",
	sessions: "Sessions",
	updates: "Updates",
};

const isSource = oneOf(NOTICE_SOURCES);

/** The tabs: every notice, or the unread ones only. */
export const NOTICE_VIEWS = ["all", "unread"] as const;

export type NoticeView = (typeof NOTICE_VIEWS)[number];

export const VIEW_LABELS: Record<NoticeView, string> = { all: "All", unread: "Unread" };

const isView = oneOf(NOTICE_VIEWS);

export interface NoticeFilter {
	view: NoticeView;
	/** The sources kept; none keeps every source. */
	sources: ReadonlySet<NoticeSource>;
	/** How many days back a notice was received. */
	received: DayRange | null;
}

export const NO_FILTER: NoticeFilter = { view: "all", sources: new Set(), received: null };

/** Whether **Filter** leaves anything out; the tab is not a filter. */
export const filters = ({ sources, received }: NoticeFilter): boolean => sources.size > 0 || received !== null;

/** `filter` with **Filter**'s fields cleared, its tab kept. */
export const withoutFilters = (filter: NoticeFilter): NoticeFilter => ({ ...filter, sources: new Set(), received: null });

/** The stored filter, with {@link NO_FILTER}'s value for each part that is missing or unreadable. */
export function decodeFilter(raw: string | null): NoticeFilter {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return NO_FILTER;
	const { view, sources, received } = stored;
	return {
		view: isView(view) ? view : NO_FILTER.view,
		sources: new Set(isTexts(sources) ? sources.filter(isSource) : []),
		received: isDayRange(received) ? received : null,
	};
}

export const encodeFilter = ({ view, sources, received }: NoticeFilter): string => JSON.stringify({ view, sources: NOTICE_SOURCES.filter(source => sources.has(source)), received });

/** A notice with what the page reads of its presentation. */
export interface ListedNotice {
	notice: Notice;
	source: NoticeSource;
	headline: string;
	preview: string;
}

export const listNotice = (notice: Notice, now: number): ListedNotice => {
	const { source, headline, preview } = presentNotice(notice, now);
	return { notice, source, headline, preview };
};

const onTab = (item: ListedNotice, view: NoticeView): boolean => view === "all" || !item.notice.read;

/** Each source with how many of `listed` it sent that `view`'s tab shows: all of them on **All**, the unread ones on **Unread**. */
export const sourceOptions = (listed: readonly ListedNotice[], view: NoticeView): FilterOption<NoticeSource>[] =>
	NOTICE_SOURCES.map(source => ({ key: source, label: SOURCE_LABELS[source], count: listed.filter(item => item.source === source && onTab(item, view)).length }));

/** Whether every word of `query` is in the notice's headline, text, or source name; an empty query matches all. */
export const matchesQuery = ({ source, headline, preview }: ListedNotice, query: string): boolean => everyWord(query)(`${headline} ${preview} ${SOURCE_LABELS[source]}`);

/** Whether `item` is on `filter`'s tab, passes its fields, and matches `query`, at `now` in ms. */
export const keepsNotice = (item: ListedNotice, { view, sources, received }: NoticeFilter, query: string, now: number): boolean =>
	onTab(item, view) && (sources.size === 0 || sources.has(item.source)) && withinLast(item.notice.at, received, now) && matchesQuery(item, query);

/** How the list groups its notices: unread under **New** and the rest under **Earlier**, by source, or not at all. */
export const GROUPINGS = ["new", "source", "none"] as const;

export type NoticeGrouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<NoticeGrouping, string> = { new: "New and earlier", source: "Source", none: "No grouping" };

/** What **Display** sets: the grouping. */
export type NoticeDisplay = GroupingDisplay<NoticeGrouping>;

export const { DEFAULT_DISPLAY, decodeDisplay, encodeDisplay } = groupingDisplay(GROUPINGS, "new");

/** A group of the list; the one group of **No grouping** has no heading. */
export interface NoticeGroup {
	key: string;
	heading: { title: string } | null;
	items: ListedNotice[];
}

/** `listed` in groups by `grouping`, each unread first, keeping their order otherwise, and leaving out empty groups. */
export function groupedNotices(grouping: NoticeGrouping, listed: readonly ListedNotice[]): NoticeGroup[] {
	const unread = listed.filter(item => !item.notice.read);
	const read = listed.filter(item => item.notice.read);
	const groups: NoticeGroup[] =
		grouping === "new"
			? [
					{ key: "new", heading: { title: "New" }, items: unread },
					{ key: "earlier", heading: { title: "Earlier" }, items: read },
				]
			: grouping === "source"
				? NOTICE_SOURCES.map(source => ({ key: `source:${source}`, heading: { title: SOURCE_LABELS[source] }, items: [...unread, ...read].filter(item => item.source === source) }))
				: [{ key: "none", heading: null, items: [...unread, ...read] }];
	return groups.filter(group => group.items.length > 0);
}
