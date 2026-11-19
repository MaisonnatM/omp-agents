/** The Memory page's Project memory tab: one repository's memories in a table grouped by kind, each edited, added, or deleted in a drawer over it. */
import { IconFolderOpen, IconPlusSmall } from "central-icons";
import { useEffect, useState } from "react";
import { everyWord } from "../../../src/shared/every-word";
import { PROJECT_MEMORY_KINDS, type ProjectMemoryEntry, type ProjectMemoryKind, type ProjectMemoryOp, type ProjectMemoryRepo, type ProjectMemoryView } from "../../../src/shared/memory-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { type Editable, useEditableRead } from "../../editable-read";
import { dateLabel } from "../../labels";
import { shownRepo } from "../../memory-view";
import { editProjectMemory, PROJECT_MEMORY_URL } from "../../api";
import { CommandPicker } from "../command-picker";
import { CountPill } from "../count-pill";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar } from "../list-split";
import { SearchField } from "../search-field";
import { LoadNote } from "../sheet-details";
import { KIND_LABELS, KindBadge, KindDot, MemoryEditor, sourceLabel } from "./project-memory-editor";
import { memoryHash } from "./tabs";

/** The memory open in the drawer: one by its slug, or a new one being written. */
type Open = { slug: string } | "new" | null;

const CHIP = "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

/** `repo`, the repository the address names, else the one holding `cwd`, the sidebar's workspace. */
export function ProjectMemoryTab({ repo, cwd }: { repo: string | null; cwd: string | null }) {
	const view = useEditableRead<ProjectMemoryView>(PROJECT_MEMORY_URL);
	if (view.data === null) {
		return (
			<div className="px-6 py-6">
				<LoadNote loading="Reading project memory…" error={view.error && `Cannot read project memory: ${view.error}`} />
			</div>
		);
	}
	const shown = shownRepo(view.data.repos, repo, cwd);
	if (shown === null) return <p className="px-6 py-6 text-sm text-muted-foreground">No workspace is in a git repository, so there is no project memory to show.</p>;
	return <RepoMemory key={shown.root} repo={shown} repos={view.data.repos} view={view} />;
}

/** The repositories, each with how many memories it holds; picking one opens its address. */
function RepoPicker({ repo, repos }: { repo: ProjectMemoryRepo; repos: ProjectMemoryRepo[] }) {
	return (
		<span className="contents" {...activityControl("memory.project.repo")}>
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
										<span className="ml-auto text-xs text-muted-foreground tabular-nums">{each.memories.length.toLocaleString()}</span>
									</span>
								),
								selected: each.root === repo.root,
								onSelect: () => {
									if (each.root !== repo.root) location.hash = memoryHash({ tab: "project", repo: each.root });
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

/** The kind chips, repository picker, filter, and New memory over the table, and the drawer while a memory is open. */
function RepoMemory({ repo, repos, view }: { repo: ProjectMemoryRepo; repos: ProjectMemoryRepo[]; view: Editable<ProjectMemoryView> }) {
	const [open, setOpen] = useState<Open>(null);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<ProjectMemoryKind | null>(null);
	const matches = everyWord(query);
	const found = repo.memories.filter(memory => matches(`${memory.slug}\n${memory.line}\n${memory.body}`));
	const groups = (kind === null ? PROJECT_MEMORY_KINDS : [kind]).map(each => ({ kind: each, memories: found.filter(memory => memory.kind === each) })).filter(group => group.memories.length > 0);
	const memories = groups.flatMap(group => group.memories);
	const entry = open !== null && open !== "new" ? (repo.memories.find(memory => memory.slug === open.slug) ?? null) : null;
	const send = (ops: ProjectMemoryOp[]): Promise<ProjectMemoryView> => view.write(() => editProjectMemory({ root: repo.root, ops }));
	const drawer = open === "new" || entry !== null;
	useEffect(() => {
		if (!drawer) return;
		const onKey = (event: KeyboardEvent) => {
			if (!event.defaultPrevented && event.key === "Escape") setOpen(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [drawer]);
	const chips: { value: ProjectMemoryKind | null; label: string; count: number }[] = [
		{ value: null, label: "All", count: found.length },
		...PROJECT_MEMORY_KINDS.map(each => ({ value: each, label: KIND_LABELS[each], count: found.filter(memory => memory.kind === each).length })),
	];
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
				<RepoPicker repo={repo} repos={repos} />
				<div role="group" aria-label="Kind" className="flex items-center gap-1.5">
					{chips.map(chip => (
						<button
							key={chip.label}
							type="button"
							aria-pressed={kind === chip.value}
							onClick={() => setKind(chip.value)}
							className={cn(CHIP, kind === chip.value ? "border-foreground/20 bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
						>
							{chip.value !== null && <KindDot kind={chip.value} />}
							{chip.label}
							<span className="tabular-nums text-muted-foreground">{chip.count}</span>
						</button>
					))}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<SearchField label="Filter memories" placeholder="Filter" query={query} onQuery={setQuery} className="w-44 min-w-0" />
					<Button variant="ghost" size="compact" leadingIcon={IconPlusSmall} onClick={() => setOpen("new")} {...activityControl("memory.project.add")}>
						New memory
					</Button>
				</div>
			</div>
			<div className="relative min-h-0 flex-1">
				<div className="h-full overflow-auto">
					<MemoryTable groups={groups} grouped={kind === null} entry={entry} onOpen={slug => setOpen({ slug })} />
					{repo.memories.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">No memory in {repo.name} yet. An agent records one with its project_memory tool, or click New memory.</p>}
					{repo.memories.length > 0 && memories.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">No memory matches.</p>}
				</div>
				{drawer && (
					<>
						<button type="button" aria-label="Close the memory" tabIndex={-1} onClick={() => setOpen(null)} className="absolute inset-0 z-10 cursor-default bg-background/40 motion-safe:animate-in motion-safe:fade-in-0" />
						<aside aria-label="Open memory" className="absolute inset-y-0 right-0 z-20 w-[min(36rem,100%)] overflow-y-auto border-l border-border bg-background shadow-surface-4 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-8">
							<OpenMemory entry={entry} memories={memories} setOpen={setOpen} send={send} />
						</aside>
					</>
				)}
			</div>
		</div>
	);
}

/** The memories' table; with every kind shown, a sticky header with its count heads each kind's rows. */
function MemoryTable({ groups, grouped, entry, onOpen }: { groups: { kind: ProjectMemoryKind; memories: ProjectMemoryEntry[] }[]; grouped: boolean; entry: ProjectMemoryEntry | null; onOpen: (slug: string) => void }) {
	if (groups.length === 0) return null;
	return (
		<table className="w-full table-fixed border-collapse text-sm">
			<colgroup>
				<col className="w-28" />
				<col className="w-64" />
				<col />
				<col className="w-24" />
				<col className="w-36" />
			</colgroup>
			<thead className="sticky top-0 z-[2] bg-background">
				<tr className="h-9 border-b border-border text-left text-xs text-muted-foreground">
					<th className="pl-4 font-medium">Kind</th>
					<th className="font-medium">Slug</th>
					<th className="font-medium">Line</th>
					<th className="font-medium">Updated</th>
					<th className="pr-4 font-medium">Session</th>
				</tr>
			</thead>
			{groups.map(group => (
				<tbody key={group.kind}>
					{grouped && (
						<tr>
							<th colSpan={5} scope="colgroup" className="sticky top-9 z-[1] h-9 border-b border-border bg-muted/80 pl-4 text-left text-xs font-medium backdrop-blur">
								<span className="flex items-center gap-2">
									<KindDot kind={group.kind} />
									{KIND_LABELS[group.kind]}
									<CountPill count={group.memories.length} />
								</span>
							</th>
						</tr>
					)}
					{group.memories.map(memory => (
						<tr
							key={memory.slug}
							tabIndex={0}
							aria-current={memory === entry || undefined}
							onClick={() => onOpen(memory.slug)}
							onKeyDown={event => {
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								onOpen(memory.slug);
							}}
							className={cn("h-10 cursor-pointer border-b border-border/60 outline-none hover:bg-accent/50 focus-visible:bg-accent/50", memory === entry && "bg-accent hover:bg-accent")}
							{...activityControl("memory.project.open")}
						>
							<td className="pl-4">
								<KindBadge kind={memory.kind} />
							</td>
							<td className="truncate pr-3 font-mono text-xs text-muted-foreground">{memory.slug}</td>
							<td className="truncate pr-3">{memory.line}</td>
							<td className="text-xs text-muted-foreground tabular-nums">{dateLabel(memory.updated)}</td>
							<td className="truncate pr-4 text-xs text-muted-foreground">{sourceLabel(memory.source)}</td>
						</tr>
					))}
				</tbody>
			))}
		</table>
	);
}

/** The drawer's memory, or the new one, under a bar that steps through the table's rows and closes it. */
function OpenMemory({ entry, memories, setOpen, send }: { entry: ProjectMemoryEntry | null; memories: ProjectMemoryEntry[]; setOpen: (open: Open) => void; send: (ops: ProjectMemoryOp[]) => Promise<ProjectMemoryView> }) {
	const at = entry === null ? -1 : memories.indexOf(entry);
	return (
		<section aria-label={entry?.slug ?? "New memory"}>
			<DetailBar
				leading={entry === null ? "New memory" : <span className="font-mono">{entry.slug}</span>}
				previous={{ label: "Previous memory", icon: CH_PREVIOUS, onClick: at > 0 ? () => setOpen({ slug: memories[at - 1]!.slug }) : undefined }}
				next={{ label: "Next memory", icon: CH_NEXT, onClick: at >= 0 && at < memories.length - 1 ? () => setOpen({ slug: memories[at + 1]!.slug }) : undefined }}
				close={{ label: "Close the memory", icon: CH_CLOSE, onClick: () => setOpen(null) }}
			/>
			<MemoryEditor key={entry?.slug ?? "new"} entry={entry} send={send} onSaved={slug => setOpen({ slug })} onDeleted={() => setOpen(null)} />
		</section>
	);
}
