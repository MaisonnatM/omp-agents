/** What the Pull requests page's list keeps and how it groups them: its tabs, **Filter**, search, and **Display**. */
import { type PullRequestSummary, type RepoPullRequests, repoKey, repoName } from "../src/shared/github";
import { GROUP_TITLES, type MoveGroup, type PullRequestOrder, type PullRequestSection, type SectionRow, sectionTitles, strings } from "./pull-requests-model";

/** The sections the list shows, which a tab or **Filter** picks; never empty. */
export type ShownSections = ReadonlySet<MoveGroup>;

export const EVERY_SECTION: ShownSections = new Set(GROUP_TITLES);

/** A tab above the list, which shows a preset of its sections. */
export type PullRequestView = "open" | "your-move" | "approved" | "merged" | "all";

export const PULL_REQUEST_VIEWS: Record<PullRequestView, { label: string; sections: ShownSections }> = {
	open: { label: "Open", sections: new Set(GROUP_TITLES.filter(title => title !== "Recently merged")) },
	"your-move": { label: "Your move", sections: new Set(["Your move"]) },
	approved: { label: "Approved", sections: new Set(["Approved"]) },
	merged: { label: "Merged", sections: new Set(["Recently merged"]) },
	all: { label: "All", sections: EVERY_SECTION },
};

const sameSections = (a: ShownSections, b: ShownSections): boolean => a.size === b.size && [...a].every(title => b.has(title));

/** The tab whose preset `shown` is, `null` for sections you picked one by one. */
export const viewOf = (shown: ShownSections): PullRequestView | null =>
	(Object.keys(PULL_REQUEST_VIEWS) as PullRequestView[]).find(view => sameSections(PULL_REQUEST_VIEWS[view].sections, shown)) ?? null;

/** `set` with `value` flipped. */
export function withToggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
	const next = new Set(set);
	if (!next.delete(value)) next.add(value);
	return next;
}

/** `shown` with `title` flipped; the same set when that would leave no section. */
export function withSectionToggled(shown: ShownSections, title: MoveGroup): ShownSections {
	const next = withToggled(shown, title);
	return next.size === 0 ? shown : next;
}

/** How far back **Created** or **Updated** reaches, in days. */
export type DayRange = 1 | 3 | 7 | 14 | 30;

export const DAY_RANGES: Record<DayRange, string> = { 1: "Last day", 3: "Last 3 days", 7: "Last week", 14: "Last 2 weeks", 30: "Last month" };

const DAY = 86_400_000;

const isDayRange = (value: unknown): value is DayRange => typeof value === "number" && Object.hasOwn(DAY_RANGES, value);

/** What **Filter** keeps; an empty set keeps every repository or author, and `null` any date. */
export interface PullRequestFilter {
	sections: ShownSections;
	/** By `repoKey`. */
	repos: ReadonlySet<string>;
	/** By login. */
	authors: ReadonlySet<string>;
	created: DayRange | null;
	/** Updated within, which **Updated** names. */
	since: DayRange | null;
}

export const NO_FILTER: PullRequestFilter = { sections: EVERY_SECTION, repos: new Set(), authors: new Set(), created: null, since: null };

/** Whether `filter` leaves anything out. */
export const filters = ({ sections, repos, authors, created, since }: PullRequestFilter): boolean =>
	sections.size < EVERY_SECTION.size || repos.size > 0 || authors.size > 0 || created !== null || since !== null;

/** The stored filter, with {@link NO_FILTER}'s value for each part that is missing or unreadable; sections that name none show every section. */
export function decodeFilter(raw: string | null): PullRequestFilter {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return NO_FILTER;
	}
	if (typeof stored !== "object" || stored === null) return NO_FILTER;
	const { sections, repos, authors, created, since } = stored as Record<string, unknown>;
	const titles = strings(sections).filter((title): title is MoveGroup => (GROUP_TITLES as string[]).includes(title));
	return {
		sections: titles.length === 0 ? EVERY_SECTION : new Set(titles),
		repos: new Set(strings(repos)),
		authors: new Set(strings(authors)),
		created: isDayRange(created) ? created : null,
		since: isDayRange(since) ? since : null,
	};
}

export const encodeFilter = ({ sections, repos, authors, created, since }: PullRequestFilter): string =>
	JSON.stringify({ sections: GROUP_TITLES.filter(title => sections.has(title)), repos: [...repos], authors: [...authors], created, since });

/** Whether every word of `query` is in `pr`'s title, `#number`, branch, author, or repository; an empty query matches all. */
export function matchesQuery(pr: PullRequestSummary, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const text = `${pr.title} #${pr.number} ${pr.head} ${pr.author.login} ${pr.owner}/${pr.repo}`.toLowerCase();
	return words.every(word => text.includes(word));
}

/** Whether `pr` passes `filter`'s author and dates and matches `query`, at `now` in ms; sections and repositories filter whole groups instead. */
export const keepsPullRequest = (pr: PullRequestSummary, { authors, created, since }: PullRequestFilter, query: string, now: number): boolean =>
	(authors.size === 0 || authors.has(pr.author.login)) &&
	(created === null || pr.createdAt >= now - created * DAY) &&
	(since === null || pr.updatedAt >= now - since * DAY) &&
	matchesQuery(pr, query);

/** `sections` less those `shown` leaves out; with `empty`, each shown section in page order, those with no pull request too. */
export function shownSectionsOf(sections: readonly PullRequestSection[], shown: ShownSections, order: PullRequestOrder, empty: boolean): PullRequestSection[] {
	if (!empty) return sections.filter(({ title }) => shown.has(title));
	const byTitle = new Map(sections.map(section => [section.title, section]));
	return sectionTitles(order)
		.filter(title => shown.has(title))
		.map(title => byTitle.get(title) ?? { title, rows: [] });
}

/** What the list's headings are: a repository with its sections, a section with its repositories, an author with theirs, or one list. */
export type PullRequestGrouping = "repository" | "section" | "author" | "none";

export const GROUPINGS: Record<PullRequestGrouping, string> = { repository: "Repository", section: "Section", author: "Author", none: "No grouping" };

/** What **Display** sets: the grouping, and whether a section with no pull request still shows. */
export interface PullRequestDisplay {
	grouping: PullRequestGrouping;
	empty: boolean;
}

export const DEFAULT_DISPLAY: PullRequestDisplay = { grouping: "repository", empty: false };

export function decodeDisplay(raw: string | null): PullRequestDisplay {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return DEFAULT_DISPLAY;
	}
	if (typeof stored !== "object" || stored === null) return DEFAULT_DISPLAY;
	const { grouping, empty } = stored as Record<string, unknown>;
	return {
		grouping: typeof grouping === "string" && Object.hasOwn(GROUPINGS, grouping) ? (grouping as PullRequestGrouping) : DEFAULT_DISPLAY.grouping,
		empty: empty === true,
	};
}

export const encodeDisplay = (display: PullRequestDisplay): string => JSON.stringify(display);

/** A row of a grouping other than by repository, with the repository whose first workspace a session on it starts in. */
export interface GroupedRow {
	row: SectionRow;
	repo: RepoPullRequests;
}

/** A table under a heading: a repository's rows under a section, a section's rows under an author, or every row under no grouping. */
export interface ListCard {
	key: string;
	title: string;
	/** The section it lists, under the grouping by section or author, whose count **Your move** draws stronger. */
	section: MoveGroup | null;
	rows: GroupedRow[];
}

/** A heading of the list and its tables; `title` is `null` under no grouping, which has no heading. */
export interface ListGroup {
	key: string;
	title: string | null;
	cards: ListCard[];
}

/** Whether `above` is the stack member right above `below`. */
const joins = (above: GroupedRow | undefined, below: GroupedRow | undefined): boolean =>
	!!above?.row.stack && !!below?.row.stack && above.row.unit === below.row.unit && above.row.stack.position === below.row.stack.position + 1;

/** `rows` with each stack's joins redrawn, since gathering rows from several sections or leaving some out moves their neighbours. */
const relinked = (rows: GroupedRow[]): GroupedRow[] =>
	rows.map((item, at) => {
		const { stack } = item.row;
		return stack ? { ...item, row: { ...item.row, stack: { ...stack, joinsAbove: joins(rows[at - 1], item), joinsBelow: joins(item, rows[at + 1]) } } } : item;
	});

/**
 * The list under `grouping`, from `repos` and their sections at the same index: by section, a heading per section in
 * page order with a table per repository; by author, a heading per author, most pull requests first, with a table per
 * section in page order; or with no grouping, one table of every row. A heading with no table leaves the list.
 */
export function groupedList(grouping: Exclude<PullRequestGrouping, "repository">, repos: readonly RepoPullRequests[], sectionsOf: readonly PullRequestSection[][], order: PullRequestOrder): ListGroup[] {
	const titles = sectionTitles(order);
	if (grouping === "section")
		return titles.flatMap((title): ListGroup[] => {
			const cards = repos.flatMap((repo, at): ListCard[] => {
				const section = sectionsOf[at]!.find(each => each.title === title);
				return section ? [{ key: repoKey(repo), title: repoName(repo), section: title, rows: section.rows.map(row => ({ row, repo })) }] : [];
			});
			return cards.length === 0 ? [] : [{ key: title, title, cards }];
		});
	if (grouping === "none") {
		const rows = repos.flatMap((repo, at) => sectionsOf[at]!.flatMap(section => section.rows.map(row => ({ row, repo }))));
		return rows.length === 0 ? [] : [{ key: "all", title: null, cards: [{ key: "all", title: "Pull requests", section: null, rows: relinked(rows) }] }];
	}
	const bySection = titles.map(title => ({
		title,
		rows: repos.flatMap((repo, at) => (sectionsOf[at]!.find(each => each.title === title)?.rows ?? []).map(row => ({ row, repo }))),
	}));
	const logins = Map.groupBy(
		bySection.flatMap(({ rows }) => rows),
		({ row }) => row.pr.author.login,
	);
	return [...logins]
		.toSorted(([a, aRows], [b, bRows]) => bRows.length - aRows.length || a.localeCompare(b))
		.map(([login]) => ({
			key: login,
			title: login,
			cards: bySection.flatMap(({ title, rows }): ListCard[] => {
				const own = rows.filter(({ row }) => row.pr.author.login === login);
				return own.length === 0 ? [] : [{ key: title, title, section: title, rows: relinked(own) }];
			}),
		}));
}

/** A heading's fold key under `grouping`; a section's heading ends in `:` and its title, so the sections that start folded do too. */
export const groupFoldKey = (grouping: PullRequestGrouping, group: string): string => `${grouping}:${group}`;

/** A table's fold key under its heading's; a section's table ends in `:` and its title too, so it starts folded as its section does. */
export const cardFoldKey = (groupKey: string, card: string): string => `${groupKey}:${card}`;

/** The pull requests `groups` shows, in its order, less those under the headings and tables `isFolded` folds. */
export const groupedPullRequests = (grouping: PullRequestGrouping, groups: readonly ListGroup[], isFolded: (key: string) => boolean): PullRequestSummary[] =>
	groups.flatMap(group => {
		const key = groupFoldKey(grouping, group.key);
		if (group.title !== null && isFolded(key)) return [];
		return group.cards.flatMap(card => (isFolded(cardFoldKey(key, card.key)) ? [] : card.rows.map(({ row }) => row.pr)));
	});
