/** The Memory page's Glossary tab: one repository's `GLOSSARY.md` as a table of its terms under their sections, beside the open term. */
import { IconBook, IconFolderOpen } from "central-icons";
import { useRef, useState } from "react";
import { everyWord } from "../../../src/shared/every-word";
import type { GlossaryRepo, GlossaryTerm, GlossaryView } from "../../../src/shared/memory-page";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { GLOSSARY_URL } from "../../api";
import { useRead } from "../../reads";
import { useShortcuts } from "../../shortcuts";
import { CommandPicker } from "../command-picker";
import { CountPill } from "../count-pill";
import { useReturnFocus } from "../list-page";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { SearchField } from "../search-field";
import { MessageMarkdown } from "../message-markdown";
import { LoadNote } from "../sheet-details";
import { memoryHash } from "./tabs";

/** One term with the section that holds it; `key` is `<section index>:<term index>`, since a term may repeat across sections. */
interface Row {
	key: string;
	section: string | null;
	term: GlossaryTerm;
}

interface Group {
	key: string;
	title: string | null;
	rows: Row[];
}

const termCount = (repo: GlossaryRepo): number => repo.sections.reduce((sum, section) => sum + section.terms.length, 0);

/** A definition's first line as plain text, for its row. */
const preview = (definition: string): string => (definition.split("\n")[0] ?? "").replace(/\*\*|`|(?<!\w)_|_(?!\w)/g, "");

/** `repo`, the repository the address names; the first with a glossary when it names none, or one without a glossary. */
export function GlossaryTab({ repo }: { repo: string | null }) {
	const view = useRead<GlossaryView>(GLOSSARY_URL);
	if (view.data === null) {
		return (
			<div className="px-4 py-4">
				<LoadNote loading="Reading glossaries…" error={view.error && `Cannot read the glossaries: ${view.error}`} />
			</div>
		);
	}
	const shown = view.data.repos.find(each => each.root === repo) ?? view.data.repos[0];
	if (!shown) return <p className="px-4 py-4 text-sm text-muted-foreground">No workspace repository has a GLOSSARY.md yet.</p>;
	return <RepoGlossary key={shown.root} repo={shown} repos={view.data.repos} />;
}

/** The repositories with a glossary, each with how many terms it defines; picking one opens its address. */
function RepoPicker({ repo, repos }: { repo: GlossaryRepo; repos: GlossaryRepo[] }) {
	return (
		<span className="contents" {...activityControl("memory.glossary.repo")}>
			<CommandPicker
				trigger={<span className="max-w-64 truncate">{repo.name}</span>}
				icon={IconFolderOpen}
				ariaLabel={`Repository: ${repo.rootDisplay}`}
				tooltip={repo.rootDisplay}
				search={{ label: "Search repositories" }}
				width="lg"
				list={{
					kind: "ready",
					groups: [
						{
							key: "repos",
							items: repos.map(each => ({
								value: `${each.name} ${each.rootDisplay}`,
								label: (
									<span className="flex min-w-0 flex-1 items-baseline gap-2">
										<span className="truncate">{each.name}</span>
										<span className="truncate text-xs text-muted-foreground">{each.rootDisplay}</span>
										<span className="ml-auto text-xs text-muted-foreground tabular-nums">{termCount(each).toLocaleString()}</span>
									</span>
								),
								selected: each.root === repo.root,
								onSelect: () => {
									if (each.root !== repo.root) location.hash = memoryHash({ tab: "glossary", repo: each.root });
								},
							})),
						},
					],
				}}
				empty="No repository matches."
			/>
		</span>
	);
}

/** The repository picker and search over the terms' table, with the open term beside it. */
function RepoGlossary({ repo, repos }: { repo: GlossaryRepo; repos: GlossaryRepo[] }) {
	const [open, setOpen] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const rowButtons = useRef(new Map<string, HTMLButtonElement>());
	const all: Group[] = repo.sections.map((section, at) => ({ key: `${at}`, title: section.title, rows: section.terms.map((term, index) => ({ key: `${at}:${index}`, section: section.title, term })) }));
	const matches = everyWord(query);
	const groups = all.map(group => ({ ...group, rows: group.rows.filter(({ term }) => matches(`${term.term}\n${term.definition}\n${term.avoid.join("\n")}`)) })).filter(group => group.rows.length > 0);
	const shownRows = groups.flatMap(group => group.rows);
	const entry = open === null ? null : (all.flatMap(group => group.rows).find(row => row.key === open) ?? null);
	useReturnFocus(entry?.key ?? null, key => key, key => rowButtons.current.get(key), shownRows);
	const step = (by: 1 | -1): void => {
		const at = entry !== null ? shownRows.indexOf(entry) : shownRows.findIndex(row => rowButtons.current.get(row.key) === document.activeElement);
		const next = at >= 0 ? shownRows[at + by] : shownRows[by === 1 ? 0 : shownRows.length - 1];
		if (!next) return;
		if (entry !== null) return setOpen(next.key);
		const button = rowButtons.current.get(next.key);
		button?.focus();
		button?.scrollIntoView({ block: "nearest" });
	};
	useShortcuts({ memoryGlossaryNext: () => step(1), memoryGlossaryPrevious: () => step(-1), memoryGlossaryClose: () => setOpen(null) });
	const at = entry === null ? -1 : shownRows.indexOf(entry);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
				<RepoPicker repo={repo} repos={repos} />
				<span className="text-xs text-muted-foreground tabular-nums">{query === "" ? `${termCount(repo).toLocaleString()} terms` : `${shownRows.length.toLocaleString()} of ${termCount(repo).toLocaleString()} terms`}</span>
				<div className="ml-auto flex items-center gap-2">
					<SearchField label="Search terms" placeholder="Search" query={query} onQuery={setQuery} className="w-36" />
				</div>
			</div>
			<div className="min-h-0 flex-1">
				<ListSplit
					widthKey="omp-agents.glossary-list-width"
					resizeLabel="Resize the term list"
					detailLabel="Open term"
					defaultWidth={560}
					empty={{ icon: IconBook, title: "No term open", hint: "Pick a term to read it here." }}
					list={
						<div className="@container">
							<TermTable caption={`Terms in ${repo.name}`} groups={groups} entry={entry} rowButtons={rowButtons.current} onOpen={setOpen} />
							{shownRows.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">No term matches.</p>}
						</div>
					}
					detail={
						entry === null ? null : (
							<section key={entry.key} aria-label={entry.term.term}>
								<DetailBar
									leading={entry.section ?? repo.name}
									previous={{ label: "Previous term", icon: CH_PREVIOUS, shortcut: "memoryGlossaryPrevious", onClick: at > 0 ? () => step(-1) : undefined }}
									next={{ label: "Next term", icon: CH_NEXT, shortcut: "memoryGlossaryNext", onClick: at >= 0 && at < shownRows.length - 1 ? () => step(1) : undefined }}
									close={{ label: "Close the term", icon: CH_CLOSE, shortcut: "memoryGlossaryClose", onClick: () => setOpen(null) }}
								/>
								<TermDetail term={entry.term} />
							</section>
						)
					}
				/>
			</div>
		</div>
	);
}

/** The open term: its name, its definition rendered, and the words to avoid for it. */
function TermDetail({ term }: { term: GlossaryTerm }) {
	return (
		<div className="flex flex-col gap-4 px-6 py-5">
			<h2 className="text-lg font-semibold">{term.term}</h2>
			<div className="text-sm leading-relaxed">
				<MessageMarkdown text={term.definition} />
			</div>
			{term.avoid.length > 0 && (
				<div>
					<h3 className="mb-2 text-xs font-medium text-muted-foreground">Avoid</h3>
					<ul className="flex flex-wrap gap-1.5">
						{term.avoid.map(word => (
							<li key={word} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
								{word}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

const HEAD = "h-9 px-2 text-left text-xs font-medium text-muted-foreground";

/** A column too wide for a narrow table shrinks to nothing rather than leaving the table, so the section headers' span still matches the columns. */
const NO_AVOID = "@max-3xl:invisible @max-3xl:w-0 @max-3xl:p-0";

/** The terms' table, a sticky header with its count heading each section's rows; Definition keeps the room, and Avoid goes under 48rem. */
function TermTable({ caption, groups, entry, rowButtons, onOpen }: { caption: string; groups: Group[]; entry: Row | null; rowButtons: Map<string, HTMLButtonElement>; onOpen: (key: string) => void }) {
	if (groups.length === 0) return null;
	return (
		<table className="w-full table-fixed border-collapse text-sm">
			<caption className="sr-only">{caption}</caption>
			<thead className="sticky top-0 z-2 bg-background">
				<tr className="border-b border-border">
					<th scope="col" className={cn(HEAD, "w-48 pl-4")}>
						Term
					</th>
					<th scope="col" className={cn(HEAD, "@max-3xl:pr-4")}>
						Definition
					</th>
					<th scope="col" className={cn(HEAD, "w-44 pr-4", NO_AVOID)}>
						Avoid
					</th>
				</tr>
			</thead>
			{groups.map(group => (
				<tbody key={group.key}>
					{group.title !== null && (
						<tr>
							<th colSpan={3} scope="colgroup" className="sticky top-9 z-1 h-9 border-b border-border bg-muted/80 pl-4 text-left text-xs font-medium backdrop-blur">
								<span className="flex items-center gap-2">
									{group.title}
									<CountPill count={group.rows.length} />
								</span>
							</th>
						</tr>
					)}
					{group.rows.map(row => {
						const current = row.key === entry?.key;
						const avoid = row.term.avoid.join(", ");
						return (
							<tr key={row.key} className={cn("relative h-10 border-b border-border/60 hover:bg-accent/50 has-[:focus-visible]:bg-accent/50", current && "bg-accent hover:bg-accent")}>
								<td className="pr-2 pl-4">
									<button
										type="button"
										ref={button => {
											if (button) rowButtons.set(row.key, button);
											else rowButtons.delete(row.key);
										}}
										title={row.term.term}
										aria-current={current || undefined}
										onClick={() => onOpen(row.key)}
										className="block w-full min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
										{...activityControl("memory.glossary.open")}
									>
										{row.term.term}
									</button>
								</td>
								<td className="truncate px-2 text-muted-foreground @max-3xl:pr-4" title={preview(row.term.definition)}>
									{preview(row.term.definition)}
								</td>
								<td className={cn("truncate pr-4 pl-2 text-xs text-muted-foreground", NO_AVOID)} title={avoid}>
									{avoid}
								</td>
							</tr>
						);
					})}
				</tbody>
			))}
		</table>
	);
}
