/** The Memory page's Project memory tab: one repository's memories, or every repository's, in a table grouped by kind, beside the open memory, which is edited, added, or deleted there. */
import { IconBrain, IconFolderOpen, IconPlusSmall } from "central-icons";
import { useRef, useState } from "react";
import { MEMORY_KINDS, type MemoryKind, type RawOp } from "../../../templates/omp/agent/extensions/project-memory/contract";
import { everyWord } from "../../../src/shared/every-word";
import type { ProjectMemoryEntry, ProjectMemoryRepo, ProjectMemoryView } from "../../../src/shared/memory-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { editProjectMemory, PROJECT_MEMORY_URL } from "../../api";
import { type Editable, useEditableRead } from "../../editable-read";
import { dateLabel } from "../../labels";
import { ALL_REPOS, shownRepo } from "./memory-view";
import { useShortcuts } from "../../shortcuts";
import { CommandPicker } from "../command-picker";
import { CountPill } from "../count-pill";
import { useReturnFocus } from "../list-page";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { SearchField } from "../search-field";
import { LoadNote } from "../sheet-details";
import { type Draft, draftOf, isSaved, KIND_LABELS, KindDot, MemoryEditor, sessionOf } from "./project-memory-editor";
import { memoryHash } from "./tabs";

/** One memory with the repository that holds it; `key` tells apart the same slug in two repositories. */
interface Row {
	key: string;
	repo: ProjectMemoryRepo;
	memory: ProjectMemoryEntry;
}

const rowKey = (repo: ProjectMemoryRepo, slug: string): string => `${repo.root}\n${slug}`;

/** The memory open beside the table: one by its row key, or a new one being written. */
type Open = { key: string } | "new" | null;

/** The key of a draft: the row's key, or `""` for the new one, which no row key can be. */
const draftKey = (row: Row | null): string => row?.key ?? "";

/** `repo`, the repository the address names, or `ALL_REPOS` for every one, else the one holding `cwd`, the sidebar's workspace. */
export function ProjectMemoryTab({ repo, cwd }: { repo: string | null; cwd: string | null }) {
	const view = useEditableRead<ProjectMemoryView>(PROJECT_MEMORY_URL);
	if (view.data === null) {
		return (
			<div className="px-4 py-4">
				<LoadNote loading="Reading project memory…" error={view.error && `Cannot read project memory: ${view.error}`} />
			</div>
		);
	}
	if (repo === ALL_REPOS) return <RepoMemory key={ALL_REPOS} scope={null} repos={view.data.repos} view={view} />;
	const shown = shownRepo(view.data.repos, repo, cwd);
	if (shown === null) return <p className="px-4 py-4 text-sm text-muted-foreground">No workspace is in a git repository, so there is no project memory to show.</p>;
	return <RepoMemory key={shown.root} scope={shown} repos={view.data.repos} view={view} />;
}

/** **All projects**, then the repositories, each with how many memories it holds; picking one opens its address. */
function RepoPicker({ scope, repos }: { scope: ProjectMemoryRepo | null; repos: ProjectMemoryRepo[] }) {
	const total = repos.reduce((sum, each) => sum + each.memories.length, 0);
	const choices = [
		{ root: ALL_REPOS, name: "All projects", detail: `${repos.length.toLocaleString()} repositories`, count: total },
		...repos.map(each => ({ root: each.root, name: each.name, detail: each.rootDisplay, count: each.memories.length })),
	];
	const current = scope?.root ?? ALL_REPOS;
	return (
		<span className="contents" {...activityControl("memory.project.repo")}>
			<CommandPicker
				trigger={<span className="max-w-64 truncate">{scope?.name ?? "All projects"}</span>}
				icon={IconFolderOpen}
				ariaLabel={`Repository: ${scope?.rootDisplay ?? "All projects"}`}
				tooltip={scope?.rootDisplay ?? "All projects"}
				search={{ label: "Search repositories" }}
				width="lg"
				list={{
					kind: "ready",
					groups: [
						{
							key: "repos",
							items: choices.map(each => ({
								value: `${each.name} ${each.detail}`,
								label: (
									<span className="flex min-w-0 flex-1 items-baseline gap-2">
										<span className="truncate">{each.name}</span>
										<span className="truncate text-xs text-muted-foreground">{each.detail}</span>
										<span className="ml-auto text-xs text-muted-foreground tabular-nums">{each.count.toLocaleString()}</span>
									</span>
								),
								selected: each.root === current,
								onSelect: () => {
									if (each.root !== current) location.hash = memoryHash({ tab: "project", repo: each.root });
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

/** The repository picker, kind filter, search, and New memory over the table, with the open memory beside it; `scope` `null` shows every repository's. */
function RepoMemory({ scope, repos, view }: { scope: ProjectMemoryRepo | null; repos: ProjectMemoryRepo[]; view: Editable<ProjectMemoryView> }) {
	const [open, setOpen] = useState<Open>(null);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<MemoryKind | null>(null);
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const rowButtons = useRef(new Map<string, HTMLButtonElement>());
	const newButton = useRef<HTMLButtonElement>(null);
	const all: Row[] = (scope === null ? repos : [scope]).flatMap(repo => repo.memories.map(memory => ({ key: rowKey(repo, memory.slug), repo, memory })));
	if (scope === null) all.sort((a, b) => b.memory.updated.localeCompare(a.memory.updated));
	const matches = everyWord(query);
	const found = all.filter(({ repo, memory }) => matches(`${memory.slug}\n${memory.line}\n${memory.body}${scope === null ? `\n${repo.name}` : ""}`));
	const groups = (kind === null ? MEMORY_KINDS : [kind]).map(each => ({ kind: each, rows: found.filter(row => row.memory.kind === each) })).filter(group => group.rows.length > 0);
	const shownRows = groups.flatMap(group => group.rows);
	const entry = open !== null && open !== "new" ? (all.find(row => row.key === open.key) ?? null) : null;
	const shown = (open === "new" && scope !== null) || entry !== null;
	useReturnFocus(shown ? draftKey(entry) : null, key => key, key => (key === "" ? newButton.current : rowButtons.current.get(key)), shownRows);
	const target = entry?.repo ?? scope;
	const send = (ops: RawOp[]): Promise<ProjectMemoryView> => (target === null ? Promise.reject(new Error("No repository to save in.")) : view.write(() => editProjectMemory({ root: target.root, ops })));
	const keepDraft = (of: Row | null, draft: Draft | null): void =>
		setDrafts(every => {
			const { [draftKey(of)]: _, ...rest } = every;
			return draft === null || isSaved(of?.memory ?? null, draft) ? rest : { ...rest, [draftKey(of)]: draft };
		});
	const step = (by: 1 | -1): void => {
		if (open === "new") return;
		const at = entry !== null ? shownRows.indexOf(entry) : shownRows.findIndex(row => rowButtons.current.get(row.key) === document.activeElement);
		const next = at >= 0 ? shownRows[at + by] : shownRows[by === 1 ? 0 : shownRows.length - 1];
		if (!next) return;
		if (entry !== null) return setOpen({ key: next.key });
		const button = rowButtons.current.get(next.key);
		button?.focus();
		button?.scrollIntoView({ block: "nearest" });
	};
	useShortcuts({ memoryProjectNext: () => step(1), memoryProjectPrevious: () => step(-1), memoryProjectClose: () => setOpen(null) });
	const at = entry === null ? -1 : shownRows.indexOf(entry);
	const chips: { value: MemoryKind | null; label: string; count: number }[] = [
		{ value: null, label: "All", count: found.length },
		...MEMORY_KINDS.map(each => ({ value: each, label: KIND_LABELS[each], count: found.filter(row => row.memory.kind === each).length })),
	];
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
				<RepoPicker scope={scope} repos={repos} />
				<div role="group" aria-label="Kind" className="flex items-center gap-1">
					{chips.map(chip => (
						<Button key={chip.label} variant="ghost" size="compact" active={kind === chip.value} aria-pressed={kind === chip.value} onClick={() => setKind(chip.value)}>
							{chip.value !== null && <KindDot kind={chip.value} />}
							{chip.label}
							<span className="ml-1 text-muted-foreground tabular-nums">{chip.count}</span>
						</Button>
					))}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<SearchField label="Search memories" placeholder="Search" query={query} onQuery={setQuery} className="w-36" />
					{scope !== null && (
						<Button ref={newButton} variant="ghost" size="compact" leadingIcon={IconPlusSmall} onClick={() => setOpen("new")} {...activityControl("memory.project.add")}>
							New memory
						</Button>
					)}
				</div>
			</div>
			<div className="min-h-0 flex-1">
				<ListSplit
					widthKey="omp-agents.project-memory-list-width"
					resizeLabel="Resize the memory list"
					detailLabel="Open memory"
					defaultWidth={560}
					empty={{ icon: IconBrain, title: "No memory open", hint: "Pick a memory to read and edit it here." }}
					list={
						<div className="@container">
							<MemoryTable
								caption={scope === null ? "Memories in every project" : `Memories in ${scope.name}`}
								withProject={scope === null}
								groups={groups}
								grouped={kind === null}
								entry={entry}
								drafts={drafts}
								rowButtons={rowButtons.current}
								onOpen={key => setOpen({ key })}
							/>
							{all.length === 0 && (
								<p className="px-4 py-4 text-sm text-muted-foreground">
									{scope === null ? "No project memory yet. An agent records one with its project_memory tool." : `No memory in ${scope.name} yet. An agent records one with its project_memory tool, or click New memory.`}
								</p>
							)}
							{all.length > 0 && shownRows.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">No memory matches.</p>}
						</div>
					}
					detail={
						shown ? (
							<section key={draftKey(entry)} aria-label={entry?.memory.slug ?? "New memory"}>
								<DetailBar
									leading={entry === null ? "New memory" : <span className="font-mono">{entry.memory.slug}</span>}
									previous={{ label: "Previous memory", icon: CH_PREVIOUS, shortcut: "memoryProjectPrevious", onClick: at > 0 ? () => step(-1) : undefined }}
									next={{ label: "Next memory", icon: CH_NEXT, shortcut: "memoryProjectNext", onClick: at >= 0 && at < shownRows.length - 1 ? () => step(1) : undefined }}
									close={{ label: "Close the memory", icon: CH_CLOSE, shortcut: "memoryProjectClose", onClick: () => setOpen(null) }}
								/>
								<MemoryEditor
									entry={entry?.memory ?? null}
									draft={drafts[draftKey(entry)] ?? draftOf(entry?.memory ?? null)}
									onDraft={draft => keepDraft(entry, draft)}
									send={send}
									onSaved={slug => {
										keepDraft(entry, null);
										if (target !== null) setOpen({ key: rowKey(target, slug) });
									}}
									onDeleted={() => {
										keepDraft(entry, null);
										setOpen(null);
									}}
								/>
							</section>
						) : null
					}
				/>
			</div>
		</div>
	);
}

const HEAD = "h-9 px-2 text-left text-xs font-medium text-muted-foreground";

/** A column too wide for a narrow table shrinks to nothing rather than leaving the table, so the kind headers' span still matches the columns. */
const NO_SLUG = "@max-3xl:invisible @max-3xl:w-0 @max-3xl:p-0";
const NO_SESSION = "@max-4xl:invisible @max-4xl:w-0 @max-4xl:p-0";

/**
 * The memories' table; with every kind shown, a sticky header with its count heads each kind's rows, and with one kind
 * picked the chip names it, so no column repeats the kind. `withProject` adds the repository's column, for All projects.
 * Line keeps the room: Session goes under 56rem, then Slug under 48rem.
 */
function MemoryTable({
	caption,
	withProject,
	groups,
	grouped,
	entry,
	drafts,
	rowButtons,
	onOpen,
}: {
	caption: string;
	withProject: boolean;
	groups: { kind: MemoryKind; rows: Row[] }[];
	grouped: boolean;
	entry: Row | null;
	drafts: Record<string, Draft>;
	rowButtons: Map<string, HTMLButtonElement>;
	onOpen: (key: string) => void;
}) {
	if (groups.length === 0) return null;
	return (
		<table className="w-full table-fixed border-collapse text-sm">
			<caption className="sr-only">{caption}</caption>
			<thead className="sticky top-0 z-2 bg-background">
				<tr className="border-b border-border">
					<th scope="col" className={cn(HEAD, "w-52 pl-4", NO_SLUG)}>
						Slug
					</th>
					<th scope="col" className={cn(HEAD, "@max-3xl:pl-4")}>
						Line
					</th>
					{withProject && (
						<th scope="col" className={cn(HEAD, "w-32")}>
							Project
						</th>
					)}
					<th scope="col" className={cn(HEAD, "w-24 @max-4xl:pr-4")}>
						Updated
					</th>
					<th scope="col" className={cn(HEAD, "w-28 pr-4", NO_SESSION)}>
						Session
					</th>
				</tr>
			</thead>
			{groups.map(group => (
				<tbody key={group.kind}>
					{grouped && (
						<tr>
							<th colSpan={withProject ? 5 : 4} scope="colgroup" className="sticky top-9 z-1 h-9 border-b border-border bg-muted/80 pl-4 text-left text-xs font-medium backdrop-blur">
								<span className="flex items-center gap-2">
									<KindDot kind={group.kind} />
									{KIND_LABELS[group.kind]}
									<CountPill count={group.rows.length} />
								</span>
							</th>
						</tr>
					)}
					{group.rows.map(row => {
						const { memory } = row;
						const session = sessionOf(memory.source);
						const current = row.key === entry?.key;
						return (
							<tr key={row.key} className={cn("relative h-10 border-b border-border/60 hover:bg-accent/50 has-[:focus-visible]:bg-accent/50", current && "bg-accent hover:bg-accent")}>
								<td className={cn("truncate pl-4 pr-2 font-mono text-xs text-muted-foreground", NO_SLUG)}>{memory.slug}</td>
								<td className="px-2 @max-3xl:pl-4">
									<button
										type="button"
										ref={button => {
											if (button) rowButtons.set(row.key, button);
											else rowButtons.delete(row.key);
										}}
										title={memory.line}
										aria-current={current || undefined}
										onClick={() => onOpen(row.key)}
										className="flex w-full min-w-0 items-center gap-2 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
										{...activityControl("memory.project.open")}
									>
										<span className="truncate">{memory.line}</span>
										{drafts[row.key] && <span className="shrink-0 text-xs text-muted-foreground">Unsaved</span>}
									</button>
								</td>
								{withProject && (
									<td className="truncate px-2 text-xs text-muted-foreground" title={row.repo.rootDisplay}>
										{row.repo.name}
									</td>
								)}
								<td className="px-2 text-xs text-muted-foreground tabular-nums @max-4xl:pr-4">{dateLabel(memory.updated)}</td>
								<td className={cn("truncate pr-4 pl-2 text-xs text-muted-foreground", session !== null && "font-mono", NO_SESSION)}>{session ?? "This page"}</td>
							</tr>
						);
					})}
				</tbody>
			))}
		</table>
	);
}
