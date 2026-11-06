import { Copy, GitMerge, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type WorktreeBlockerCode, type WorktreeEntry, type WorktreeInventory, type WorktreeMerge, type WorktreeMetrics, worktreeKey as keyOf } from "../../../src/worktrees-shared";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { readWorktreeMetrics, readWorktrees } from "../../api";
import { errorText } from "../../../src/json";
import { age, formatBytes } from "../../labels";
import { useInlineConfirm } from "../../use-inline-confirm";
import { REMOVAL_KEEPS, removeWorktrees, useRemovalState, useRemovalStates, useRemovedAt, useRemoving } from "../../worktree-removals";
import { Spinner } from "../spinner";

type SortKey = "name" | "activity" | "size";

const SORTS: Record<SortKey, string> = { size: "Size", activity: "Last omp activity", name: "Name" };

type FilterKey = "all" | "merged" | "removable";

const FILTERS: Record<FilterKey, { label: string; keep: (entry: WorktreeEntry) => boolean }> = {
	all: { label: "All", keep: () => true },
	merged: { label: "Merged", keep: entry => entry.merged !== null },
	removable: { label: "Removable", keep: entry => entry.blockers.length === 0 },
};

const BLOCKER_BADGES: Record<WorktreeBlockerCode, { label: string; color: BadgeColor }> = {
	main: { label: "Main", color: "gray" },
	server: { label: "Dashboard", color: "blue" },
	occupied: { label: "Session open", color: "blue" },
	locked: { label: "Locked", color: "amber" },
	changed: { label: "Unsaved changes", color: "amber" },
	"nested-repository": { label: "Nested repository", color: "amber" },
	"unknown-agent-location": { label: "Subagents unknown", color: "amber" },
	drift: { label: "Changed", color: "amber" },
	unregistered: { label: "Unregistered", color: "amber" },
	unmerged: { label: "Not merged", color: "gray" },
	foreign: { label: "Foreign checkout", color: "red" },
	unreadable: { label: "Unreadable", color: "red" },
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What every removal deletes and keeps, said beside each button that queues one. */
const REMOVAL_TERMS = `Ignored files such as dependencies and .env go with each checkout. ${REMOVAL_KEEPS}`;

const mergedLabel = (merge: WorktreeMerge): string => (merge.by === "pull-request" ? `Merged #${merge.number}` : "Merged");

const mergedTitle = (merge: WorktreeMerge): string => (merge.by === "pull-request" ? `Pull request #${merge.number} merged` : `${merge.branch} contains this commit`);

const blockerText = (blockers: { message: string }[]): string => blockers.map(blocker => blocker.message).join(" ");

/** The bytes of every target measured so far, or `null` before any is. */
function totalBytes(targets: { repository: string; path: string }[], metrics: Record<string, WorktreeMetrics>): number | null {
	const sizes = targets.map(target => metrics[keyOf(target)]?.allocatedBytes).filter((bytes): bytes is number => bytes != null);
	return sizes.length === 0 ? null : sizes.reduce((sum, bytes) => sum + bytes, 0);
}

function activityText(entry: WorktreeEntry): string {
	if (entry.lastActivity === null) return "No omp session";
	return Date.now() - entry.lastActivity < 60_000 ? "Just now" : `${age(entry.lastActivity)} ago`;
}

/** `path` split into its folder, shortened beside the repository's main checkout, and its last segment, which always shows. */
function pathParts(path: string, repositoryPath: string): { folder: string; name: string } {
	const beside = repositoryPath.slice(0, repositoryPath.lastIndexOf("/") + 1);
	const shown = beside && path.startsWith(beside) ? path.slice(beside.length) : path;
	const cut = shown.lastIndexOf("/") + 1;
	return { folder: shown.slice(0, cut), name: shown.slice(cut) };
}

/** The settings tab for Git worktrees of repositories omp sessions ran in, plus a repository path entered here. */
export function WorktreesTab({ cwd, active }: { cwd: string | null; active: boolean }) {
	const [refresh, setRefresh] = useState(0);
	const [extras, setExtras] = useState<string[]>([]);
	const [pathDraft, setPathDraft] = useState("");
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<FilterKey>("all");
	const [sort, setSort] = useState<SortKey>("size");
	const [read, setRead] = useState<{ inventory: WorktreeInventory; at: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const [metrics, setMetrics] = useState<Record<string, WorktreeMetrics>>({});
	const [ranked, setRanked] = useState<Record<string, WorktreeMetrics>>({});
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const removedAt = useRemovedAt();
	const queue = useRemovalStates();
	/** Whether nothing blocks `entry` and it is not already queued, so a selection or **Remove merged** can take it. */
	const removable = (entry: WorktreeEntry): boolean => entry.blockers.length === 0 && !queue.has(keyOf(entry));

	useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
		const at = Date.now();
		setReading(true);
		const scopes = cwd === null ? [null, ...extras] : [cwd, ...extras];
		Promise.all(scopes.map(scope => readWorktrees(scope, controller.signal))).then(
			parts => {
				if (controller.signal.aborted) return;
				const seen = new Set<string>();
				const next: WorktreeInventory = { repositories: [], errors: [] };
				for (const part of parts) {
					next.errors.push(...part.errors);
					for (const repo of part.repositories) {
						if (seen.has(repo.repository)) continue;
						seen.add(repo.repository);
						next.repositories.push(repo);
					}
				}
				setRead({ inventory: next, at });
				setError(null);
				setReading(false);
				setSelected(current => new Set([...current].filter(key => next.repositories.some(repo => repo.worktrees.some(entry => keyOf(entry) === key)))));
			},
			(err: unknown) => {
				if (controller.signal.aborted) return;
				setError(errorText(err));
				setReading(false);
			},
		);
		// An aborted read settles into nothing, so its end clears `reading` here; a new read sets it again.
		return () => {
			controller.abort();
			setReading(false);
		};
	}, [active, cwd, extras, refresh]);

	useEffect(() => {
		if (!active || !read) return;
		const controller = new AbortController();
		const targets = read.inventory.repositories.flatMap(repo => repo.worktrees.filter(entry => !entry.missing));
		let cursor = 0;
		const worker = async (): Promise<void> => {
			while (cursor < targets.length && !controller.signal.aborted) {
				const target = targets[cursor++];
				if (!target) return;
				try {
					const measured = await readWorktreeMetrics(target, controller.signal);
					if (!controller.signal.aborted) setMetrics(current => ({ ...current, [keyOf(target)]: measured }));
				} catch (err) {
					if (controller.signal.aborted) return;
					setMetrics(current => ({
						...current,
						[keyOf(target)]: { repository: target.repository, path: target.path, allocatedBytes: null, lastCommit: null, modified: null, untracked: null, errors: [errorText(err)] },
					}));
				}
			}
		};
		void Promise.all([worker(), worker(), worker()]);
		return () => controller.abort();
	}, [active, read]);

	// A worktree removed since the list was read leaves it at once, without reading every worktree again.
	const inventory = useMemo((): WorktreeInventory | null => {
		if (!read) return null;
		const gone = (entry: WorktreeEntry): boolean => (removedAt.get(keyOf(entry)) ?? 0) >= read.at;
		return { ...read.inventory, repositories: read.inventory.repositories.map(repo => ({ ...repo, worktrees: repo.worktrees.filter(entry => !gone(entry)) })) };
	}, [read, removedAt]);

	const measurable = (inventory?.repositories ?? []).flatMap(repo => repo.worktrees.filter(entry => !entry.missing));
	const unmeasured = measurable.filter(entry => !metrics[keyOf(entry)]).length;

	// Rows keep their order while sizes arrive, so a row does not move under the pointer; they re-sort once every size is in.
	useEffect(() => {
		if (unmeasured === 0) setRanked(metrics);
	}, [unmeasured, metrics]);

	const rows = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return (inventory?.repositories ?? []).map(repo => {
			const worktrees = repo.worktrees
				.filter(entry => FILTERS[filter].keep(entry) && (!needle || `${entry.branch ?? ""} ${entry.path} ${repo.name}`.toLowerCase().includes(needle)))
				.toSorted((a, b) => {
					if (sort === "name") return (a.branch ?? a.path).localeCompare(b.branch ?? b.path);
					if (sort === "activity") return (b.lastActivity ?? -1) - (a.lastActivity ?? -1);
					return (ranked[keyOf(b)]?.allocatedBytes ?? -1) - (ranked[keyOf(a)]?.allocatedBytes ?? -1);
				});
			return { ...repo, worktrees };
		});
	}, [inventory, ranked, query, filter, sort]);

	const all = (inventory?.repositories ?? []).flatMap(repo => repo.worktrees);
	const visible = rows.flatMap(repo => repo.worktrees);
	const chosen = visible.filter(entry => removable(entry) && selected.has(keyOf(entry)));
	const merged = visible.filter(entry => entry.merged !== null);
	const notices = Map.groupBy(inventory?.errors ?? [], item => item.error);

	const addRepository = (event: FormEvent): void => {
		event.preventDefault();
		const path = pathDraft.trim();
		if (!path || extras.includes(path)) return;
		setExtras(current => [...current, path]);
		setPathDraft("");
	};

	const totalAll = totalBytes(measurable, metrics);
	const totalMerged = totalBytes(merged, metrics);
	const totalChosen = totalBytes(chosen, metrics);

	return (
		<section className="space-y-5" aria-label="Worktrees">
			<p className="text-sm text-muted-foreground">
				{cwd === null ? "Repositories where an omp session ran." : "The repository of this workspace."} Last omp activity comes from session files. Disk use is approximate and may not become free.
			</p>
			{inventory ? (
				<dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
					<div>
						<dt className="text-xs text-muted-foreground">Worktrees</dt>
						<dd className="font-medium tabular-nums">
							{all.length} <span className="font-normal text-muted-foreground">in {inventory.repositories.length} {inventory.repositories.length === 1 ? "repository" : "repositories"}</span>
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted-foreground">Disk use</dt>
						<dd className="font-medium tabular-nums">
							{totalAll === null ? "…" : formatBytes(totalAll)}
							{unmeasured > 0 ? <span className="font-normal text-muted-foreground"> · measuring {unmeasured} of {measurable.length}</span> : null}
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted-foreground">Merged</dt>
						<dd className="font-medium tabular-nums">
							{merged.length}
							{totalMerged === null ? null : <span className="font-normal text-muted-foreground"> · {formatBytes(totalMerged)}</span>}
						</dd>
					</div>
				</dl>
			) : null}
			<div className="flex flex-wrap items-center gap-3">
				<div role="group" aria-label="Show" className="flex gap-1">
					{(Object.keys(FILTERS) as FilterKey[]).map(key => (
						<Button key={key} variant="ghost" size="compact" active={key === filter} aria-pressed={key === filter} onClick={() => setFilter(key)}>
							{FILTERS[key].label}
						</Button>
					))}
				</div>
				<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm">
					<span className="sr-only">Search worktrees</span>
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" className="w-36 bg-transparent outline-none" />
				</label>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					Sort
					<Select<SortKey>
						items={SORTS}
						value={sort}
						onValueChange={next => {
							if (!next) return;
							setSort(next);
							setRanked(metrics);
						}}
					>
						<SelectTrigger aria-label="Sort">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(SORTS) as SortKey[]).map(key => (
								<SelectItem key={key} value={key}>
									{SORTS[key]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Button type="button" variant="ghost" size="compact" leadingIcon={RefreshCw} loading={reading} onClick={() => setRefresh(count => count + 1)}>
						Refresh
					</Button>
					<RemoveMergedButton entries={merged.filter(removable)} />
				</div>
			</div>
			{error ? (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Cannot list worktrees: {error}
				</p>
			) : null}
			{[...notices].map(([message, items]) => (
				<p key={message} role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
					<span className="font-medium">{items.map(item => item.path.slice(item.path.lastIndexOf("/") + 1)).join(", ")}</span>: {message}
				</p>
			))}
			{inventory === null && error === null ? <p className="text-sm text-muted-foreground">{active ? "Reading worktrees…" : ""}</p> : null}
			{inventory && all.length === 0 ? <p className="text-sm text-muted-foreground">No git worktrees in repositories omp sessions ran in.</p> : null}
			{inventory && all.length > 0 && visible.length === 0 ? <p className="text-sm text-muted-foreground">No worktree matches.</p> : null}
			{rows.map(repo => {
				if (repo.worktrees.length === 0) return null;
				const open = repo.worktrees.filter(removable);
				const picked = open.filter(entry => selected.has(keyOf(entry))).length;
				const repoBytes = totalBytes(repo.worktrees, metrics);
				const pickAll = (): void =>
					setSelected(current => {
						const next = new Set(current);
						for (const entry of open) {
							if (picked === open.length) next.delete(keyOf(entry));
							else next.add(keyOf(entry));
						}
						return next;
					});
				return (
					<section key={repo.repository} className="space-y-1">
						<h3 className="flex items-baseline gap-2 text-sm">
							<span className="font-medium">{repo.name}</span>
							<span className="text-muted-foreground tabular-nums">
								{plural(repo.worktrees.length, "worktree")}
								{repoBytes === null ? "" : ` · ${formatBytes(repoBytes)}`}
							</span>
							<span className="min-w-0 truncate text-xs text-muted-foreground">{repo.path}</span>
						</h3>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[52rem] table-fixed text-left text-sm">
								<caption className="sr-only">Worktrees in {repo.name}</caption>
								<colgroup>
									<col className="w-8" />
									<col />
									<col className="w-36" />
									<col className="w-28" />
									<col className="w-24" />
									<col className="w-44" />
									<col className="w-32" />
								</colgroup>
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b border-border">
										<th className="py-1.5 font-normal">
											<input
												type="checkbox"
												checked={open.length > 0 && picked === open.length}
												ref={box => {
													if (box) box.indeterminate = picked > 0 && picked < open.length;
												}}
												disabled={open.length === 0}
												aria-label={`Select every removable worktree in ${repo.name}`}
												onChange={pickAll}
											/>
										</th>
										<th className="py-1.5 font-normal">Worktree</th>
										<th className="py-1.5 font-normal">Last omp activity</th>
										<th className="py-1.5 font-normal">Last commit</th>
										<th className="py-1.5 pr-4 text-right font-normal">Size</th>
										<th className="py-1.5 font-normal">Changes</th>
										<th className="py-1.5">
											<span className="sr-only">Actions</span>
										</th>
									</tr>
								</thead>
								<tbody>
									{repo.worktrees.map(entry => (
										<WorktreeRow
											key={keyOf(entry)}
											entry={entry}
											repositoryPath={repo.path}
											measured={metrics[keyOf(entry)]}
											checked={selected.has(keyOf(entry))}
											onToggle={() =>
												setSelected(current => {
													const next = new Set(current);
													if (!next.delete(keyOf(entry))) next.add(keyOf(entry));
													return next;
												})
											}
										/>
									))}
								</tbody>
							</table>
						</div>
					</section>
				);
			})}
			{chosen.length > 0 ? (
				<div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2 text-sm shadow-md">
					<span className="font-medium tabular-nums">{chosen.length} selected</span>
					{totalChosen === null ? null : <span className="text-muted-foreground tabular-nums">{formatBytes(totalChosen)}</span>}
					<div className="ml-auto flex gap-2">
						<Button type="button" variant="ghost" size="compact" onClick={() => setSelected(new Set())}>
							Clear
						</Button>
						<DeleteChosenButton chosen={chosen} onQueued={() => setSelected(new Set())} />
					</div>
				</div>
			) : null}
			<form className="flex flex-wrap items-end gap-2 border-t border-border pt-4" onSubmit={addRepository}>
				<label className="space-y-1 text-sm text-muted-foreground">
					Show another repository
					<input value={pathDraft} onChange={event => setPathDraft(event.target.value)} placeholder="/path/to/repository" className="block h-7 w-80 max-w-full rounded-md border border-border bg-transparent px-2 text-foreground" />
				</label>
				<Button type="submit" variant="secondary" size="compact" disabled={!pathDraft.trim()}>
					Show
				</Button>
			</form>
		</section>
	);
}

function Pending() {
	return (
		<span className="inline-block h-3 w-12 rounded bg-muted motion-safe:animate-pulse">
			<span className="sr-only">Measuring</span>
		</span>
	);
}

/** **Remove N merged**: once you confirm, removes each merged worktree nothing blocks, one at a time; it waits while any removal is queued or running. */
function RemoveMergedButton({ entries }: { entries: WorktreeEntry[] }) {
	const removing = useRemoving();
	const confirm = useInlineConfirm("remove-merged");
	const count = entries.length;
	if (count === 0 && !removing) return null;
	const armed = confirm.isArmed("remove");
	const label = removing ? "Removing…" : armed ? `Confirm removal of ${count}?` : `Remove ${count} merged`;
	return (
		<Tooltip content={`Remove each merged worktree nothing blocks, one at a time. ${REMOVAL_TERMS}`} forceOpen={armed ? false : undefined}>
			<Button type="button" variant="secondary" size="compact" leadingIcon={removing ? Spinner : GitMerge} disabled={removing} aria-busy={removing} aria-label={label} {...confirm.props("remove", () => void removeWorktrees(entries, true))}>
				{label}
			</Button>
		</Tooltip>
	);
}

/** The selection bar's **Delete N worktrees**: once you confirm, queues the selected worktrees and clears the selection. */
function DeleteChosenButton({ chosen, onQueued }: { chosen: WorktreeEntry[]; onQueued: () => void }) {
	const confirm = useInlineConfirm("delete-chosen");
	const armed = confirm.isArmed("delete");
	const label = armed ? `Confirm deletion of ${chosen.length}?` : `Delete ${plural(chosen.length, "worktree")}`;
	const queue = (): void => {
		void removeWorktrees(chosen, false);
		onQueued();
	};
	return (
		<Tooltip content={`Delete each selected worktree, one at a time. ${REMOVAL_TERMS}`} forceOpen={armed ? false : undefined}>
			<Button type="button" variant="destructive-outline" size="compact" leadingIcon={Trash2} aria-label={label} {...confirm.props("delete", queue)}>
				{label}
			</Button>
		</Tooltip>
	);
}

function WorktreeRow({ entry, repositoryPath, measured, checked, onToggle }: { entry: WorktreeEntry; repositoryPath: string; measured: WorktreeMetrics | undefined; checked: boolean; onToggle: () => void }) {
	const state = useRemovalState(entry);
	const confirm = useInlineConfirm(`delete-${keyOf(entry)}`);
	const armed = confirm.isArmed("delete");
	const blocked = entry.blockers.length > 0;
	const label = state === "removing" ? "Removing" : state === "queued" ? "Queued" : armed ? "Confirm?" : entry.missing ? "Forget" : "Delete";
	const pending = !measured && !entry.missing;
	const { folder, name } = pathParts(entry.path, repositoryPath);
	const codes = [...new Set(entry.blockers.map(blocker => blocker.code))];
	const changes = measured?.modified == null || measured.untracked == null ? null : { modified: measured.modified, untracked: measured.untracked };
	return (
		<tr className="border-b border-border/60 align-middle last:border-b-0 hover:bg-hover/50">
			<td className="py-2">
				<input type="checkbox" checked={checked} disabled={blocked || state !== null} aria-label={`Select ${entry.path}`} onChange={onToggle} />
			</td>
			<td className="py-2 pr-3">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate font-medium">{entry.branch ?? "Detached"}</span>
					{entry.merged ? (
						<Tooltip content={mergedTitle(entry.merged)}>
							<Badge variant="dot" size="compact" color="violet" className="shrink-0">
								{mergedLabel(entry.merged)}
							</Badge>
						</Tooltip>
					) : null}
					{entry.missing ? (
						<Badge variant="dot" size="compact" color="amber" className="shrink-0">
							Directory gone
						</Badge>
					) : null}
					{codes.map(code => (
						<Tooltip key={code} content={blockerText(entry.blockers.filter(blocker => blocker.code === code))}>
							<Badge variant="dot" size="compact" color={BLOCKER_BADGES[code].color} className="shrink-0">
								{BLOCKER_BADGES[code].label}
							</Badge>
						</Tooltip>
					))}
				</div>
				<div className="flex min-w-0 text-xs text-muted-foreground" title={entry.path}>
					<span className="truncate">{folder}</span>
					<span className="shrink-0">{name}</span>
				</div>
			</td>
			<td className={`py-2 pr-3 whitespace-nowrap ${entry.lastActivity === null ? "text-muted-foreground" : ""}`}>{activityText(entry)}</td>
			<td className="py-2 pr-3 whitespace-nowrap">{pending ? <Pending /> : measured?.lastCommit == null ? <span className="text-muted-foreground">Unknown</span> : `${age(measured.lastCommit)} ago`}</td>
			<td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">{pending ? <Pending /> : measured?.allocatedBytes == null ? <span className="text-muted-foreground">Unknown</span> : formatBytes(measured.allocatedBytes)}</td>
			<td className="py-2 pr-3 whitespace-nowrap">
				{pending ? (
					<Pending />
				) : changes === null ? (
					<span className="text-muted-foreground">Unknown</span>
				) : changes.modified === 0 && changes.untracked === 0 ? (
					<span className="text-muted-foreground">Clean</span>
				) : (
					<span className="text-amber-700 dark:text-amber-400">
						{[changes.modified > 0 ? `${changes.modified} modified` : "", changes.untracked > 0 ? `${changes.untracked} untracked` : ""].filter(Boolean).join(", ")}
					</span>
				)}
			</td>
			<td className="py-2 text-right whitespace-nowrap">
				<Button type="button" variant="ghost" size="icon-compact" aria-label={`Copy ${entry.path}`} onClick={() => void navigator.clipboard.writeText(entry.path)}>
					<Copy aria-hidden />
				</Button>
				<Tooltip content={blocked ? blockerText(entry.blockers) : REMOVAL_TERMS} forceOpen={armed ? false : undefined}>
					<span className="inline-flex">
						<Button
							type="button"
							variant="ghost"
							size="compact"
							className="w-24 justify-start"
							leadingIcon={state === "removing" ? Spinner : Trash2}
							disabled={blocked || state !== null}
							aria-busy={state !== null}
							aria-label={armed ? `Confirm ${entry.missing ? "forgetting" : "deleting"} ${entry.path}` : `${entry.missing ? "Forget registration for" : "Delete"} ${entry.path}`}
							{...confirm.props("delete", () => void removeWorktrees([entry], false))}
						>
							{label}
						</Button>
					</span>
				</Tooltip>
			</td>
		</tr>
	);
}
