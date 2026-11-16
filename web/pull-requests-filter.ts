/** What the Pull requests page's list keeps and how it groups them: its tabs, **Filter**, search, and **Display**. */
import { isObject, isTexts, oneOf, parseJson } from "../src/json";
import { countBy, countedOptions, type DayRange, type FilterOption, isDayRange, withinLast } from "./list-filter";
import { everyWord } from "../src/shared/every-word";
import type { AgentOn } from "../src/shared/moves";
import { type PullRequestSummary, type RepoPullRequests, repoKey, repoName } from "../src/shared/github";
import { GROUP_TITLES, listedPullRequests, type MoveGroup, type PullRequestOrder, type PullRequestSection, pullRequestSections, type SectionRow, sectionTitles } from "./pull-requests-model";

/** The sections the list shows, which a tab or **Filter** picks; never empty. */
export type ShownSections = ReadonlySet<MoveGroup>;

export const EVERY_SECTION: ShownSections = new Set(GROUP_TITLES);

const isSectionTitle = oneOf(GROUP_TITLES);

/** The tabs above the list, in order, each showing a preset of its sections. */
export const PULL_REQUEST_VIEWS = ["open", "your-move", "approved", "merged", "all"] as const;

export type PullRequestView = (typeof PULL_REQUEST_VIEWS)[number];

export const VIEW_PRESETS: Record<PullRequestView, { label: string; sections: ShownSections }> = {
	open: { label: "Open", sections: new Set(GROUP_TITLES.filter(title => title !== "Recently merged")) },
	"your-move": { label: "Your move", sections: new Set(["Your move"]) },
	approved: { label: "Approved", sections: new Set(["Approved"]) },
	merged: { label: "Merged", sections: new Set(["Recently merged"]) },
	all: { label: "All", sections: EVERY_SECTION },
};

const sameSections = (a: ShownSections, b: ShownSections): boolean => a.size === b.size && [...a].every(title => b.has(title));

/** The tab whose preset `shown` is, `null` for sections you picked one by one. */
export const viewOf = (shown: ShownSections): PullRequestView | null => PULL_REQUEST_VIEWS.find(view => sameSections(VIEW_PRESETS[view].sections, shown)) ?? null;

/** `next`, the sections **Filter** would leave, or `shown` when that would leave none, since the list always shows a section. */
export const atLeastOneSection = (next: ShownSections, shown: ShownSections): ShownSections => (next.size === 0 ? shown : next);

/** What **Filter** keeps; an empty set keeps every repository or author, and `null` any date. */
export interface PullRequestFilter {
	sections: ShownSections;
	/** By `repoKey`. */
	repos: ReadonlySet<string>;
	/** By login. */
	authors: ReadonlySet<string>;
	created: DayRange | null;
	updated: DayRange | null;
}

export const NO_FILTER: PullRequestFilter = { sections: EVERY_SECTION, repos: new Set(), authors: new Set(), created: null, updated: null };

/** Whether `filter` leaves anything out. */
export const filters = ({ sections, repos, authors, created, updated }: PullRequestFilter): boolean =>
	sections.size < EVERY_SECTION.size || repos.size > 0 || authors.size > 0 || created !== null || updated !== null;

/** The stored filter, with {@link NO_FILTER}'s value for each part that is missing or unreadable; sections that name none show every section. */
export function decodeFilter(raw: string | null): PullRequestFilter {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return NO_FILTER;
	const { sections, repos, authors, created, updated } = stored;
	const titles = isTexts(sections) ? sections.filter(isSectionTitle) : [];
	return {
		sections: titles.length === 0 ? EVERY_SECTION : new Set(titles),
		repos: new Set(isTexts(repos) ? repos : []),
		authors: new Set(isTexts(authors) ? authors : []),
		created: isDayRange(created) ? created : null,
		updated: isDayRange(updated) ? updated : null,
	};
}

export const encodeFilter = ({ sections, repos, authors, created, updated }: PullRequestFilter): string =>
	JSON.stringify({ sections: GROUP_TITLES.filter(title => sections.has(title)), repos: [...repos], authors: [...authors], created, updated });

/**
 * The repositories **Filter** offers, those of `repos` in their order, each with how many pull requests it lists, then
 * each key of `checked` that none of them is, such as a repository you hid since, with none, so you can uncheck it.
 */
export function repoOptions(repos: readonly RepoPullRequests[], checked: ReadonlySet<string>): FilterOption[] {
	const listed = repos.map(repo => ({ key: repoKey(repo), label: repoName(repo), count: "error" in repo ? 0 : repo.pullRequests.length }));
	const keys = new Set(listed.map(({ key }) => key));
	return [...listed, ...[...checked].filter(key => !keys.has(key)).map(key => ({ key, label: key, count: 0 }))];
}

/** The authors **Filter** offers, of the pull requests of `repos`, most first, then by login, and each login of `checked` with none, so you can uncheck it. */
export const authorOptions = (repos: readonly RepoPullRequests[], checked: ReadonlySet<string>): FilterOption[] => countedOptions(countBy(listedPullRequests(repos), pr => [pr.author.login]), checked);

/** Whether every word of `query` is in `pr`'s title, `#number`, branch, author, or repository; an empty query matches all. */
export const matchesQuery = (pr: PullRequestSummary, query: string): boolean => everyWord(query)(`${pr.title} #${pr.number} ${pr.head} ${pr.author.login} ${pr.owner}/${pr.repo}`);

/** Whether `pr` passes `filter`'s author and dates and matches `query`, at `now` in ms; sections and repositories filter whole groups instead. */
export const keepsPullRequest = (pr: PullRequestSummary, { authors, created, updated }: PullRequestFilter, query: string, now: number): boolean =>
	(authors.size === 0 || authors.has(pr.author.login)) && withinLast(pr.createdAt, created, now) && withinLast(pr.updatedAt, updated, now) && matchesQuery(pr, query);

/** `sections` less those `shown` leaves out; with `empty`, each shown section in page order, those with no pull request too. */
export function shownSectionsOf(sections: readonly PullRequestSection[], shown: ShownSections, order: PullRequestOrder, empty: boolean): PullRequestSection[] {
	if (!empty) return sections.filter(({ title }) => shown.has(title));
	const byTitle = new Map(sections.map(section => [section.title, section]));
	return sectionTitles(order)
		.filter(title => shown.has(title))
		.map(title => byTitle.get(title) ?? { title, rows: [] });
}

/** A repository the list shows, with the sections of it that it shows. */
export interface ListedRepo {
	repo: RepoPullRequests;
	sections: PullRequestSection[];
}

/**
 * What the list shows of `repos`: the repositories `filter` keeps, each with the pull requests that its author and
 * dates, at `now` in ms, and `query` keep, sectioned in `order` among those alone, so a stack joins only the pull
 * requests that show; then the sections `filter` shows, every one of them with `empty`. While the filter or the search
 * leaves anything out, a repository with nothing left leaves the list too, unless `empty` keeps it.
 */
export function filteredList(
	repos: readonly RepoPullRequests[],
	filter: PullRequestFilter,
	query: string,
	order: PullRequestOrder,
	agent: AgentOn,
	empty: boolean,
	now: number,
): ListedRepo[] {
	const filtering = filters(filter) || query.trim() !== "";
	return repos.flatMap((repo): ListedRepo[] => {
		if (filter.repos.size > 0 && !filter.repos.has(repoKey(repo))) return [];
		const kept = "error" in repo ? repo : { ...repo, pullRequests: repo.pullRequests.filter(pr => keepsPullRequest(pr, filter, query, now)) };
		const sections = shownSectionsOf("error" in kept ? [] : pullRequestSections(kept.pullRequests, order, agent), filter.sections, order, empty);
		return !filtering || empty || "error" in kept || sections.some(({ rows }) => rows.length > 0) ? [{ repo: kept, sections }] : [];
	});
}

/** The list's headings, in menu order: a repository with its sections, a section with its repositories, an author with theirs, or one list. */
export const GROUPINGS = ["repository", "section", "author", "none"] as const;

export type PullRequestGrouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<PullRequestGrouping, string> = { repository: "Repository", section: "Section", author: "Author", none: "No grouping" };

const isGrouping = oneOf(GROUPINGS);

/** What **Display** sets: the grouping, and whether a section with no pull request still shows. */
export interface PullRequestDisplay {
	grouping: PullRequestGrouping;
	empty: boolean;
}

export const DEFAULT_DISPLAY: PullRequestDisplay = { grouping: "repository", empty: false };

export function decodeDisplay(raw: string | null): PullRequestDisplay {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return DEFAULT_DISPLAY;
	const { grouping, empty } = stored;
	return { grouping: isGrouping(grouping) ? grouping : DEFAULT_DISPLAY.grouping, empty: empty === true };
}

export const encodeDisplay = (display: PullRequestDisplay): string => JSON.stringify(display);

/** A row of the list, with its section and the repository whose first workspace a session on it starts in. */
export interface ListedRow {
	row: SectionRow;
	repo: RepoPullRequests;
	section: MoveGroup;
}

/** A table under a heading: a repository's section, a section's repository, an author's section, or every row under no grouping. */
export interface ListCard {
	key: string;
	title: string;
	/** The section it lists, whose count **Your move** draws stronger; `null` for the one table of no grouping. */
	section: MoveGroup | null;
	rows: ListedRow[];
}

/** A heading of the list and its tables. */
export interface ListGroup {
	key: string;
	/** `null` under no grouping, whose one table has no heading. */
	title: string | null;
	/** The repository it lists under the grouping by repository, whose heading names its workspaces and which may show why GitHub could not read it. */
	repo: RepoPullRequests | null;
	cards: ListCard[];
}

/** Whether `above` is the stack member right above `below`. */
const joins = (above: ListedRow | undefined, below: ListedRow | undefined): boolean =>
	!!above?.row.stack && !!below?.row.stack && above.row.unit === below.row.unit && above.row.stack.position === below.row.stack.position + 1;

/** `rows` with each stack's joins redrawn, since gathering rows from several sections or leaving some out moves their neighbours. */
const relinked = (rows: ListedRow[]): ListedRow[] =>
	rows.map((item, at) => {
		const { stack } = item.row;
		return stack ? { ...item, row: { ...item.row, stack: { ...stack, joinsAbove: joins(rows[at - 1], item), joinsBelow: joins(item, rows[at + 1]) } } } : item;
	});

/**
 * The list of `listed` under `grouping`. By repository, a heading per repository with a table per section, empty ones
 * too. Otherwise from every row in section order, then in repository order within a section: by section, a heading per
 * section with a table per repository; by author, a heading per author, most pull requests first, with a table per
 * section; or with no grouping, one table of every row. Those groupings leave out a heading with no row.
 */
export function groupedList(grouping: PullRequestGrouping, listed: readonly ListedRepo[], order: PullRequestOrder): ListGroup[] {
	if (grouping === "repository")
		return listed.map(({ repo, sections }) => ({
			key: repoKey(repo),
			title: repoName(repo),
			repo,
			cards: sections.map(({ title, rows }) => ({ key: title, title, section: title, rows: rows.map(row => ({ row, repo, section: title })) })),
		}));
	const bySection = Map.groupBy(
		listed.flatMap(({ repo, sections }) => sections.flatMap(({ title, rows }) => rows.map((row): ListedRow => ({ row, repo, section: title })))),
		({ section }) => section,
	);
	const rows = sectionTitles(order).flatMap(title => bySection.get(title) ?? []);
	if (grouping === "section")
		return [...Map.groupBy(rows, ({ section }) => section)].map(([title, items]) => ({
			key: title,
			title,
			repo: null,
			cards: [...Map.groupBy(items, ({ repo }) => repo)].map(([repo, own]) => ({ key: repoKey(repo), title: repoName(repo), section: title, rows: own })),
		}));
	if (grouping === "author")
		return [...Map.groupBy(rows, ({ row }) => row.pr.author.login)]
			.toSorted(([a, aRows], [b, bRows]) => bRows.length - aRows.length || a.localeCompare(b))
			.map(([login, items]) => ({
				key: login,
				title: login,
				repo: null,
				cards: [...Map.groupBy(items, ({ section }) => section)].map(([title, own]) => ({ key: title, title, section: title, rows: relinked(own) })),
			}));
	return rows.length === 0 ? [] : [{ key: "all", title: null, repo: null, cards: [{ key: "all", title: "Pull requests", section: null, rows: relinked(rows) }] }];
}

/**
 * A heading's fold key under `grouping`, which the browser keeps in localStorage: under the grouping by repository its
 * `repoKey`, as before there were groupings, else the grouping and the heading's key, so a section's heading ends in
 * `:` and its title and the sections that start folded do too.
 */
export const groupFoldKey = (grouping: PullRequestGrouping, group: string): string => (grouping === "repository" ? group : `${grouping}:${group}`);

/** A table's fold key under its heading's, which ends in `:` and the table's key, so a section's table starts folded as its section does. A repository's name holds no `:`. */
export const cardFoldKey = (groupKey: string, card: string): string => `${groupKey}:${card}`;

/** The pull requests `groups` shows, in its order, less those under the headings and tables `isFolded` folds. */
export const shownPullRequests = (grouping: PullRequestGrouping, groups: readonly ListGroup[], isFolded: (key: string) => boolean): PullRequestSummary[] =>
	groups.flatMap(group => {
		const key = groupFoldKey(grouping, group.key);
		return isFolded(key) ? [] : group.cards.flatMap(card => (isFolded(cardFoldKey(key, card.key)) ? [] : card.rows.map(({ row }) => row.pr)));
	});
