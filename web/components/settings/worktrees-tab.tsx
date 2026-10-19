import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Copy, GitMerge, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { MAX_WORKTREE_BATCH, type WorktreeEntry, type WorktreeInventory, type WorktreeMerge, type WorktreeMetrics, type WorktreeRemovalPlan, type WorktreeRemovalResult } from "../../../src/worktrees-shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { changeWorktrees, errorText, readWorktreeMetrics, readWorktrees } from "../../api";
import { age, formatBytes } from "../../labels";

type SortKey = "name" | "activity" | "size";

const SORTS: Record<SortKey, string> = { size: "Size", activity: "Last omp activity", name: "Name" };

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

function activityText(entry: WorktreeEntry): string {
	if (entry.blockers.some(blocker => blocker.code === "occupied")) return "Session open";
	return entry.lastActivity === null ? "No omp session" : `${age(entry.lastActivity)} ago`;
}

/** What blocks removal, beyond the main checkout the name already marks; empty when nothing does. */
function statusText(entry: WorktreeEntry): string {
	if (entry.missing) return "Directory gone";
	return entry.blockers.find(blocker => blocker.code !== "main")?.message ?? "";
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
	const [sort, setSort] = useState<SortKey>("size");
	const [inventory, setInventory] = useState<WorktreeInventory | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const [metrics, setMetrics] = useState<Record<string, WorktreeMetrics>>({});
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

	const rows = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return (inventory?.repositories ?? []).map(repo => {
			const worktrees = repo.worktrees
				.filter(entry => !needle || `${entry.branch ?? ""} ${entry.path} ${repo.name}`.toLowerCase().includes(needle))
				.toSorted((a, b) => {
					if (sort === "name") return (a.branch ?? a.path).localeCompare(b.branch ?? b.path);
					if (sort === "activity") return (b.lastActivity ?? -1) - (a.lastActivity ?? -1);
					const left = metrics[keyOf(a)]?.allocatedBytes;
					const right = metrics[keyOf(b)]?.allocatedBytes;
					return (right ?? -1) - (left ?? -1);
				});
			return { ...repo, worktrees };
		});
	}, [inventory, metrics, query, sort]);

	const visible = rows.flatMap(repo => repo.worktrees);
	const removable = visible.filter(entry => entry.blockers.length === 0);
	const chosen = removable.filter(entry => selected.has(keyOf(entry)));
	const merged = visible.filter(entry => entry.merged !== null);

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

	return (
		<section className="space-y-6" aria-labelledby="worktrees-heading">
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 flex-1 space-y-1">
					<h2 id="worktrees-heading" className="text-sm font-medium">
						Worktrees
					</h2>
					<p className="text-sm text-muted-foreground">
						{cwd === null ? "Repositories where an omp session ran." : "The repository of this workspace."} Last omp activity comes from session files. Disk use is approximate and may not become free.
					</p>
				</div>
				<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm">
					<span className="sr-only">Search worktrees</span>
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" className="w-36 bg-transparent outline-none" />
				</label>
				<div className="flex items-center gap-2 text-sm">
					Sort
					<Select<SortKey> items={SORTS} value={sort} onValueChange={next => next && setSort(next)}>
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
				<Button type="button" variant="ghost" size="compact" leadingIcon={RefreshCw} loading={reading} onClick={() => setRefresh(count => count + 1)}>
					Refresh
				</Button>
				<Button type="button" variant="secondary" size="compact" leadingIcon={GitMerge} disabled={merged.length === 0} onClick={() => ask(merged, true)}>
					Remove merged ({merged.length})
				</Button>
			</div>
			<form className="flex flex-wrap items-end gap-2" onSubmit={addRepository}>
				<label className="space-y-1 text-sm">
					Repository path
					<input value={pathDraft} onChange={event => setPathDraft(event.target.value)} placeholder="/path/to/repository" className="block h-7 w-80 max-w-full rounded-md border border-border bg-transparent px-2" />
				</label>
				<Button type="submit" variant="secondary" size="compact">
					Show repository
				</Button>
			</form>
			{error ? (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Cannot list worktrees: {error}
				</p>
			) : null}
			{inventory === null && error === null ? <p className="text-sm text-muted-foreground">{active ? "Reading worktrees…" : ""}</p> : null}
			{inventory && visible.length === 0 ? <p className="text-sm text-muted-foreground">No git worktrees in repositories omp sessions ran in.</p> : null}
			{inventory?.errors.map(item => (
				<p key={item.path} role="alert" className="text-sm text-red-600 dark:text-red-400">
					{item.path}: {item.error}
				</p>
			))}
			{rows.map(repo => {
				if (repo.worktrees.length === 0) return null;
				const open = repo.worktrees.filter(entry => entry.blockers.length === 0);
				const picked = open.filter(entry => selected.has(keyOf(entry))).length;
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
					<section key={repo.repository} className="space-y-2">
						<h3 className="text-sm font-medium">
							{repo.name} <span className="font-normal text-muted-foreground">{repo.path}</span>
						</h3>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[52rem] border-separate border-spacing-y-1 text-left text-sm">
								<caption className="sr-only">Worktrees in {repo.name}</caption>
								<thead className="text-xs text-muted-foreground">
									<tr>
										<th className="w-8">
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
										<th>Worktree</th>
										<th>Last omp activity</th>
										<th>Last commit</th>
										<th>Size</th>
										<th>Changes</th>
										<th>Status</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{repo.worktrees.map(entry => {
										const measured = metrics[keyOf(entry)];
										const blocked = entry.blockers.length > 0;
										const { folder, name } = pathParts(entry.path, repo.path);
										return (
											<tr key={keyOf(entry)}>
												<td>
													<input
														type="checkbox"
														checked={selected.has(keyOf(entry))}
														disabled={blocked}
														aria-label={`Select ${entry.path}`}
														onChange={() =>
															setSelected(current => {
																const next = new Set(current);
																if (!next.delete(keyOf(entry))) next.add(keyOf(entry));
																return next;
															})
														}
													/>
												</td>
												<td className="max-w-64 pr-3">
													<div className="truncate font-medium">
														{entry.branch ?? "Detached"}
														{entry.main ? " · Main" : ""}
														{entry.locked !== null ? " · Locked" : ""}
														{entry.merged ? <span title={mergedTitle(entry.merged)}> · {mergedLabel(entry.merged)}</span> : null}
													</div>
													<div className="flex min-w-0 text-muted-foreground" title={entry.path}>
														<span className="truncate">{folder}</span>
														<span className="shrink-0">{name}</span>
													</div>
												</td>
												<td className="pr-3 whitespace-nowrap">{activityText(entry)}</td>
												<td className="pr-3 whitespace-nowrap">{!measured && !entry.missing ? "Measuring…" : measured?.lastCommit == null ? "Unknown" : `${age(measured.lastCommit)} ago`}</td>
												<td className="pr-3 whitespace-nowrap">{!measured && !entry.missing ? "Measuring…" : measured?.allocatedBytes == null ? "Unknown" : formatBytes(measured.allocatedBytes)}</td>
												<td className="pr-3 whitespace-nowrap">
													{!measured && !entry.missing ? "Measuring…" : measured?.modified == null || measured.untracked == null ? "Unknown" : measured.modified === 0 && measured.untracked === 0 ? "None" : `${measured.modified} modified, ${measured.untracked} untracked`}
												</td>
												<td className="max-w-64 pr-3 text-muted-foreground">{statusText(entry)}</td>
												<td className="whitespace-nowrap text-right">
													<Button type="button" variant="ghost" size="icon-compact" aria-label={`Copy ${entry.path}`} onClick={() => void navigator.clipboard.writeText(entry.path)}>
														<Copy aria-hidden />
													</Button>
													<Button type="button" variant="ghost" size="compact" leadingIcon={Trash2} disabled={blocked} aria-label={`${entry.missing ? "Forget registration for" : "Delete"} ${entry.path}`} onClick={() => ask([entry], false)}>
														{entry.missing ? "Forget" : "Delete"}
													</Button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</section>
				);
			})}
			{chosen.length > 0 ? (
				<Button type="button" variant="primary" size="compact" onClick={() => ask(chosen, false)}>
					Delete selected ({chosen.length})
				</Button>
			) : null}
			<DialogPrimitive.Root open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
					<DialogPrimitive.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-background p-5 text-foreground shadow-md">
						{dialog && <RemovalBody dialog={dialog} acceptLoss={acceptLoss} pins={pins} onAcceptLoss={setAcceptLoss} onClose={() => setDialog(null)} onConfirm={confirm} />}
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</section>
	);
}

function RemovalBody({
	dialog,
	acceptLoss,
	pins,
	onAcceptLoss,
	onClose,
	onConfirm,
}: {
	dialog: DialogState;
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
				<Button type="button" variant="secondary" size="compact" className="mt-4" onClick={onClose}>
					Close
				</Button>
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
				{dialog.results.length + dialog.kept.length > 1 ? (
					<p className="mt-2 text-sm">
						Removed {removed}. Kept {kept}. Failed {failed}.
					</p>
				) : null}
				<ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
					{dialog.results.map(result => (
						<li key={keyOf(result)} className="break-all">
							{result.path}: {result.removed ? "Removed. The branch and transcripts were kept." : result.error !== null ? `Failed. ${result.error}` : `Kept. ${blockerText(result.blockers)}`}
						</li>
					))}
					{dialog.kept.map(plan => (
						<li key={keyOf(plan)} className="break-all">
							{plan.path}: Kept. {blockerText(plan.blockers)}
						</li>
					))}
				</ul>
				<Button type="button" variant="secondary" size="compact" className="mt-4" onClick={onClose}>
					Close
				</Button>
			</>
		);
	}
	const going = dialog.plans.filter(canRemove);
	const kept = dialog.plans.filter((plan): boolean => !canRemove(plan));
	const loss = going.some(plan => plan.ignored.length > 0 || plan.detachedCommitLoss);
	const pinnedHere = going.flatMap(plan => plan.savedSessionIds.filter(id => pins.includes(id)));
	const title = dialog.merged ? (going.length > 0 ? `Remove ${plural(going.length, "merged worktree")}?` : "No merged worktree can be removed") : dialog.plans.length === 1 ? "Remove this worktree?" : `Remove ${dialog.plans.length} worktrees?`;
	// Only Remove merged removes part of what it previewed; a hand-picked removal stays all or nothing.
	const stopped = dialog.merged ? going.length === 0 : kept.length > 0;
	return (
		<>
			<DialogPrimitive.Title className="text-base font-medium">{title}</DialogPrimitive.Title>
			{dialog.merged ? (
				<p className="mt-2 text-sm">
					{plural(going.length, "worktree")} will be removed. {plural(kept.length, "worktree")} will be kept.
				</p>
			) : null}
			<div className="mt-3 max-h-80 space-y-3 overflow-y-auto text-sm">
				{dialog.merged && going.length > 0 ? <h3 className="font-medium">Will be removed</h3> : null}
				<ul className="space-y-3">
					{going.map(plan => (
						<li key={keyOf(plan)}>
							<p className="break-all text-muted-foreground">{plan.path}</p>
							<p className="font-medium">{plan.branch ?? "Detached"}</p>
							<p>The branch {plan.branch ?? "is detached"} and session transcripts stay.</p>
							{plan.ignored.length > 0 ? <p>Ignored files that will be deleted: {plan.ignored.join(", ")}. This includes dependencies and files such as .env.</p> : null}
							{plan.detachedCommitLoss ? <p>This detached commit is not on a branch, tag, or remote. Removing the registration can make it unreachable.</p> : null}
							{plan.savedSessionIds.length > 0 ? <p>{plural(plan.savedSessionIds.length, "saved omp session")} ran here. Resume may fail after the directory is gone.</p> : null}
						</li>
					))}
				</ul>
				{dialog.merged && kept.length > 0 ? <h3 className="font-medium">Kept</h3> : null}
				<ul className="space-y-3">
					{kept.map(plan => (
						<li key={keyOf(plan)}>
							<p className="break-all text-muted-foreground">{plan.path}</p>
							{plan.kind !== "unreadable" ? <p className="font-medium">{plan.branch ?? "Detached"}</p> : null}
							<p className="text-red-600 dark:text-red-400">{blockerText(plan.blockers)}</p>
						</li>
					))}
				</ul>
			</div>
			{pinnedHere.length > 0 ? <p className="mt-3 text-sm">{plural(pinnedHere.length, "pinned session")} ran here.</p> : null}
			<p className="mt-3 text-sm text-muted-foreground">Shells and editors outside omp may still be using a checkout. Close them first. This page cannot see all of them.</p>
			{loss ? (
				<label className="mt-3 flex items-start gap-2 text-sm">
					<input type="checkbox" checked={acceptLoss} onChange={event => onAcceptLoss(event.target.checked)} />
					<span>Delete the ignored files and accept a detached commit becoming unreachable when the confirmation says so.</span>
				</label>
			) : null}
			<div className="mt-4 flex gap-2">
				<Button type="button" variant="secondary" size="compact" onClick={onClose}>
					Cancel
				</Button>
				<Button type="button" variant="primary" size="compact" disabled={stopped || (loss && !acceptLoss)} onClick={() => onConfirm(dialog.plans)}>
					{dialog.merged ? `Delete ${plural(going.length, "worktree")}` : "Delete worktree files"}
				</Button>
			</div>
		</>
	);
}
