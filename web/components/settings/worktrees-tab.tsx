import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Copy, GitMerge, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { MAX_WORKTREE_BATCH, type WorktreeBlockerCode, type WorktreeEntry, type WorktreeInventory, type WorktreeMerge, type WorktreeMetrics, type WorktreeRemovalPlan, type WorktreeRemovalResult } from "../../../src/worktrees-shared";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { changeWorktrees, readWorktreeMetrics, readWorktrees } from "../../api";
import { errorText } from "../../../src/json";
import { age, formatBytes } from "../../labels";

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

type DialogState =
	| { phase: "checking"; count: number }
	| { phase: "ready"; plans: WorktreeRemovalPlan[]; merged: boolean }
	| { phase: "removing"; count: number }
	| { phase: "done"; results: WorktreeRemovalResult[]; kept: WorktreeRemovalPlan[] }
	| { phase: "error"; message: string };

type ReadablePlan = Exclude<WorktreeRemovalPlan, { kind: "unreadable" }>;

const keyOf = (target: { repository: string; path: string }): string => `${target.repository}\0${target.path}`;

/** A plan the server could read and nothing blocks, which a confirmation removes. */
const canRemove = (plan: WorktreeRemovalPlan): plan is ReadablePlan => plan.kind !== "unreadable" && plan.blockers.length === 0;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `items` in runs of at most `MAX_WORKTREE_BATCH`, the most one removal request takes. */
const batches = <T,>(items: T[]): T[][] => Array.from({ length: Math.ceil(items.length / MAX_WORKTREE_BATCH) }, (_, index) => items.slice(index * MAX_WORKTREE_BATCH, (index + 1) * MAX_WORKTREE_BATCH));

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
export function WorktreesTab({ cwd, active, pins }: { cwd: string | null; active: boolean; pins: string[] }) {
	const [refresh, setRefresh] = useState(0);
	const [extras, setExtras] = useState<string[]>([]);
	const [pathDraft, setPathDraft] = useState("");
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<FilterKey>("all");
	const [sort, setSort] = useState<SortKey>("size");
	const [inventory, setInventory] = useState<WorktreeInventory | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const [metrics, setMetrics] = useState<Record<string, WorktreeMetrics>>({});
	const [ranked, setRanked] = useState<Record<string, WorktreeMetrics>>({});
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const [acceptLoss, setAcceptLoss] = useState(false);

	useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
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
				setInventory(next);
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
		return () => controller.abort();
	}, [active, cwd, extras, refresh]);

	useEffect(() => {
		if (!active || !inventory) return;
		const controller = new AbortController();
		const targets = inventory.repositories.flatMap(repo => repo.worktrees.filter(entry => !entry.missing));
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
	}, [active, inventory]);

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
	const chosen = visible.filter(entry => entry.blockers.length === 0 && selected.has(keyOf(entry)));
	const merged = visible.filter(entry => entry.merged !== null);
	const notices = Map.groupBy(inventory?.errors ?? [], item => item.error);

	/** Previews `targets`; `onlyMerged` also keeps each one whose work the server does not find merged. */
	const ask = (targets: WorktreeEntry[], onlyMerged: boolean): void => {
		setAcceptLoss(false);
		setDialog({ phase: "checking", count: targets.length });
		const preview = async (): Promise<WorktreeRemovalPlan[]> => {
			const plans: WorktreeRemovalPlan[] = [];
			for (const batch of batches(targets)) plans.push(...(await changeWorktrees({ action: "preview", targets: batch, merged: onlyMerged })).plans);
			return plans;
		};
		void preview().then(
			plans => setDialog({ phase: "ready", plans, merged: onlyMerged }),
			(err: unknown) => setDialog({ phase: "error", message: errorText(err) }),
		);
	};

	/** Removes the plans nothing blocks; the rest are reported as kept. */
	const confirm = (plans: WorktreeRemovalPlan[]): void => {
		const going = plans.filter(canRemove);
		const kept = plans.filter((plan): boolean => !canRemove(plan));
		setDialog({ phase: "removing", count: going.length });
		const remove = async (): Promise<WorktreeRemovalResult[]> => {
			const results: WorktreeRemovalResult[] = [];
			for (const batch of batches(going)) {
				const answer = await changeWorktrees({ action: "remove", plans: batch.map(({ repository, path, confirmation }) => ({ repository, path, confirmation })) });
				results.push(...answer.results);
			}
			return results;
		};
		void remove().then(
			results => {
				setDialog({ phase: "done", results, kept });
				if (results.some(result => result.removed)) setRefresh(count => count + 1);
			},
			(err: unknown) => {
				setDialog({ phase: "error", message: errorText(err) });
				// An earlier batch may have removed worktrees before this one failed.
				setRefresh(count => count + 1);
			},
		);
	};

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
					<Button type="button" variant="secondary" size="compact" leadingIcon={GitMerge} disabled={merged.length === 0} onClick={() => ask(merged, true)}>
						Remove merged ({merged.length})
					</Button>
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
				const open = repo.worktrees.filter(entry => entry.blockers.length === 0);
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
									<col className="w-28" />
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
											onDelete={() => ask([entry], false)}
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
						<Button type="button" variant="destructive-outline" size="compact" leadingIcon={Trash2} onClick={() => ask(chosen, false)}>
							Delete {plural(chosen.length, "worktree")}
						</Button>
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
			<DialogPrimitive.Root open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
					<DialogPrimitive.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-background p-5 text-foreground shadow-md">
						{dialog && <RemovalBody dialog={dialog} metrics={metrics} acceptLoss={acceptLoss} pins={pins} onAcceptLoss={setAcceptLoss} onClose={() => setDialog(null)} onConfirm={confirm} />}
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
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

function WorktreeRow({ entry, repositoryPath, measured, checked, onToggle, onDelete }: { entry: WorktreeEntry; repositoryPath: string; measured: WorktreeMetrics | undefined; checked: boolean; onToggle: () => void; onDelete: () => void }) {
	const blocked = entry.blockers.length > 0;
	const pending = !measured && !entry.missing;
	const { folder, name } = pathParts(entry.path, repositoryPath);
	const codes = [...new Set(entry.blockers.map(blocker => blocker.code))];
	const changes = measured?.modified == null || measured.untracked == null ? null : { modified: measured.modified, untracked: measured.untracked };
	return (
		<tr className="border-b border-border/60 align-middle last:border-b-0 hover:bg-hover/50">
			<td className="py-2">
				<input type="checkbox" checked={checked} disabled={blocked} aria-label={`Select ${entry.path}`} onChange={onToggle} />
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
				<Tooltip content={blockerText(entry.blockers)} disabled={!blocked}>
					<span className="inline-flex">
						<Button type="button" variant="ghost" size="compact" leadingIcon={Trash2} disabled={blocked} aria-label={`${entry.missing ? "Forget registration for" : "Delete"} ${entry.path}`} onClick={onDelete}>
							{entry.missing ? "Forget" : "Delete"}
						</Button>
					</span>
				</Tooltip>
			</td>
		</tr>
	);
}

function RemovalBody({
	dialog,
	metrics,
	acceptLoss,
	pins,
	onAcceptLoss,
	onClose,
	onConfirm,
}: {
	dialog: DialogState;
	metrics: Record<string, WorktreeMetrics>;
	acceptLoss: boolean;
	pins: string[];
	onAcceptLoss: (value: boolean) => void;
	onClose: () => void;
	onConfirm: (plans: WorktreeRemovalPlan[]) => void;
}) {
	if (dialog.phase === "checking") {
		return (
			<>
				<DialogPrimitive.Title className="text-base font-medium">Checking worktrees</DialogPrimitive.Title>
				<p className="mt-2 text-sm">Checking whether {dialog.count === 1 ? "this worktree" : `these ${dialog.count} worktrees`} can be removed…</p>
			</>
		);
	}
	if (dialog.phase === "error") {
		return (
			<>
				<DialogPrimitive.Title className="text-base font-medium">Could not remove the worktree</DialogPrimitive.Title>
				<p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
					{dialog.message}
				</p>
				<div className="mt-4 flex justify-end">
					<Button type="button" variant="secondary" size="compact" onClick={onClose}>
						Close
					</Button>
				</div>
			</>
		);
	}
	if (dialog.phase === "removing") {
		return (
			<>
				<DialogPrimitive.Title className="text-base font-medium">Removing worktrees</DialogPrimitive.Title>
				<p className="mt-2 text-sm">Removing {plural(dialog.count, "worktree")}…</p>
			</>
		);
	}
	if (dialog.phase === "done") {
		const removed = dialog.results.filter(result => result.removed).length;
		const failed = dialog.results.filter(result => !result.removed && result.error !== null).length;
		const kept = dialog.kept.length + dialog.results.length - removed - failed;
		return (
			<>
				<DialogPrimitive.Title className="text-base font-medium">Removal finished</DialogPrimitive.Title>
				<p className="mt-2 text-sm">
					Removed {removed}. Kept {kept}. Failed {failed}. Branches and session transcripts stay.
				</p>
				<ul className="mt-3 min-h-0 flex-1 divide-y divide-border overflow-y-auto text-sm">
					{dialog.results.map(result => (
						<li key={keyOf(result)} className="py-2">
							<p className="text-xs break-all text-muted-foreground">{result.path}</p>
							<p className={result.removed ? "" : "text-red-600 dark:text-red-400"}>{result.removed ? "Removed" : result.error !== null ? `Failed. ${result.error}` : `Kept. ${blockerText(result.blockers)}`}</p>
						</li>
					))}
					{dialog.kept.map(plan => (
						<li key={keyOf(plan)} className="py-2">
							<p className="text-xs break-all text-muted-foreground">{plan.path}</p>
							<p className="text-muted-foreground">Kept. {blockerText(plan.blockers)}</p>
						</li>
					))}
				</ul>
				<div className="mt-4 flex justify-end">
					<Button type="button" variant="secondary" size="compact" onClick={onClose}>
						Close
					</Button>
				</div>
			</>
		);
	}
	const going = dialog.plans.filter(canRemove);
	const kept = dialog.plans.filter((plan): boolean => !canRemove(plan));
	const loss = going.some(plan => plan.ignored.length > 0 || plan.detachedCommitLoss);
	const pinnedHere = going.flatMap(plan => plan.savedSessionIds.filter(id => pins.includes(id)));
	const frees = totalBytes(going, metrics);
	const title = dialog.merged ? (going.length > 0 ? `Remove ${plural(going.length, "merged worktree")}?` : "No merged worktree can be removed") : dialog.plans.length === 1 ? "Remove this worktree?" : `Remove ${dialog.plans.length} worktrees?`;
	// Only Remove merged removes part of what it previewed; a hand-picked removal stays all or nothing.
	const stopped = dialog.merged ? going.length === 0 : kept.length > 0;
	return (
		<>
			<DialogPrimitive.Title className="text-base font-medium">{title}</DialogPrimitive.Title>
			<p className="mt-1 text-sm text-muted-foreground">
				{going.length > 0 && frees !== null ? `Frees about ${formatBytes(frees)}. ` : ""}
				{dialog.merged && kept.length > 0 ? `${plural(kept.length, "worktree")} will be kept. ` : ""}
				Branches and session transcripts stay.
			</p>
			<div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
				{going.length > 0 ? (
					<ul className="divide-y divide-border rounded-md border border-border">
						{going.map(plan => {
							const bytes = metrics[keyOf(plan)]?.allocatedBytes;
							return (
								<li key={keyOf(plan)} className="space-y-0.5 px-3 py-2">
									<div className="flex items-baseline gap-2">
										<span className="min-w-0 flex-1 truncate font-medium">{plan.branch ?? "Detached"}</span>
										{bytes == null ? null : <span className="shrink-0 text-muted-foreground tabular-nums">{formatBytes(bytes)}</span>}
									</div>
									<p className="text-xs break-all text-muted-foreground">{plan.path}</p>
									{plan.ignored.length > 0 ? <p className="text-xs text-amber-700 dark:text-amber-400">Deletes ignored files: {plan.ignored.join(", ")}</p> : null}
									{plan.detachedCommitLoss ? <p className="text-xs text-amber-700 dark:text-amber-400">This detached commit is not on a branch, tag, or remote. Removing the registration can make it unreachable.</p> : null}
									{plan.savedSessionIds.length > 0 ? <p className="text-xs text-muted-foreground">{plural(plan.savedSessionIds.length, "saved omp session")} ran here. Resume may fail after the directory is gone.</p> : null}
								</li>
							);
						})}
					</ul>
				) : null}
				{kept.length > 0 ? (
					<details open={!dialog.merged || going.length === 0} className="group">
						<summary className="cursor-pointer text-muted-foreground select-none">{dialog.merged ? `Kept (${kept.length})` : `Blocked (${kept.length})`}</summary>
						<ul className="mt-2 divide-y divide-border rounded-md border border-border">
							{kept.map(plan => (
								<li key={keyOf(plan)} className="space-y-0.5 px-3 py-2">
									{plan.kind !== "unreadable" ? <p className="font-medium">{plan.branch ?? "Detached"}</p> : null}
									<p className="text-xs break-all text-muted-foreground">{plan.path}</p>
									<p className="text-xs text-red-600 dark:text-red-400">{blockerText(plan.blockers)}</p>
								</li>
							))}
						</ul>
					</details>
				) : null}
			</div>
			{pinnedHere.length > 0 ? <p className="mt-3 text-sm">{plural(pinnedHere.length, "pinned session")} ran here.</p> : null}
			<p className="mt-3 text-xs text-muted-foreground">Shells and editors outside omp may still be using a checkout. Close them first. This page cannot see all of them.</p>
			{loss ? (
				<label className="mt-3 flex items-start gap-2 text-sm">
					<input type="checkbox" className="mt-0.5" checked={acceptLoss} onChange={event => onAcceptLoss(event.target.checked)} />
					<span>Delete the ignored files and accept a detached commit becoming unreachable when the list says so.</span>
				</label>
			) : null}
			<div className="mt-4 flex justify-end gap-2">
				<Button type="button" variant="secondary" size="compact" onClick={onClose}>
					Cancel
				</Button>
				<Button type="button" variant="destructive-outline" size="compact" leadingIcon={Trash2} disabled={stopped || (loss && !acceptLoss)} onClick={() => onConfirm(dialog.plans)}>
					{dialog.merged ? `Delete ${plural(going.length, "worktree")}` : "Delete worktree files"}
				</Button>
			</div>
		</>
	);
}
