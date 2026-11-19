/** The Memory page's Project memory tab: one repository's memories beside the one open, each edited, added, or deleted in place. */
import { IconBrain, IconFolderOpen, IconPlusSmall } from "central-icons";
import { useId, useState } from "react";
import { everyWord } from "../../../src/shared/every-word";
import { PROJECT_MEMORY_KINDS, type ProjectMemoryEntry, type ProjectMemoryKind, type ProjectMemoryOp, type ProjectMemoryRepo, type ProjectMemoryView } from "../../../src/shared/memory-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { editProjectMemory, PROJECT_MEMORY_URL } from "../../api";
import { type Editable, useEditableRead } from "../../editable-read";
import { dateLabel } from "../../labels";
import { shownRepo } from "../../memory-view";
import { useInlineConfirm } from "../../use-inline-confirm";
import { CommandPicker } from "../command-picker";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { SearchField } from "../search-field";
import { ErrorText, FIELD, useSaving } from "../settings/editor";
import { LoadNote } from "../sheet-details";
import { memoryHash } from "./tabs";

const KIND_LABELS: Record<ProjectMemoryKind, string> = { decision: "Decision", fact: "Fact", lesson: "Lesson" };
const KIND_COLORS: Record<ProjectMemoryKind, string> = { decision: "blue", fact: "gray", lesson: "amber" };
const LINE_MAX = 120;
const BODY_MAX = 2000;
const TEXTAREA = "w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Who last changed a memory: this page, or the session `#<id>` names, by the start of its id. */
const sourceLabel = (source: string): string => (source === "#dashboard" ? "this page" : `session ${source.replace(/^#/, "").slice(0, 8)}`);

/** The memory open beside the list: one by its slug, or a new one being written. */
type Open = { slug: string } | "new" | null;

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

function RepoMemory({ repo, repos, view }: { repo: ProjectMemoryRepo; repos: ProjectMemoryRepo[]; view: Editable<ProjectMemoryView> }) {
	const [open, setOpen] = useState<Open>(null);
	const [query, setQuery] = useState("");
	const matches = everyWord(query);
	const memories = repo.memories.filter(memory => matches(`${memory.slug}\n${memory.line}\n${memory.body}`));
	const entry = open !== null && open !== "new" ? (repo.memories.find(memory => memory.slug === open.slug) ?? null) : null;
	const at = entry === null ? -1 : memories.indexOf(entry);
	const send = (ops: ProjectMemoryOp[]): Promise<ProjectMemoryView> => view.write(() => editProjectMemory({ root: repo.root, ops }));
	const list = (
		<div className="mx-auto w-full max-w-3xl px-3 py-2">
			{repo.memories.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No memory in {repo.name} yet. An agent records one with its project_memory tool, or click New memory.</p>}
			{repo.memories.length > 0 && memories.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No memory matches.</p>}
			<ul className="flex flex-col gap-0.5">
				{memories.map(memory => {
					const current = memory === entry;
					return (
						<li key={memory.slug}>
							<button
								type="button"
								aria-current={current || undefined}
								onClick={() => setOpen({ slug: memory.slug })}
								className={cn("flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", current && "bg-accent")}
								{...activityControl("memory.project.open")}
							>
								<span className="flex min-w-0 items-center gap-2">
									<Badge variant="dot" size="compact" color={KIND_COLORS[memory.kind]} className="shrink-0">
										{KIND_LABELS[memory.kind]}
									</Badge>
									<span className="truncate font-mono text-xs text-muted-foreground">{memory.slug}</span>
								</span>
								<span className="text-sm">{memory.line}</span>
								<span className="text-xs text-muted-foreground">
									{dateLabel(memory.updated)} · {sourceLabel(memory.source)}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
	const close = { label: "Close the memory", icon: CH_CLOSE, onClick: () => setOpen(null) };
	let detail = null;
	if (open === "new") {
		detail = (
			<section key="new" aria-label="New memory">
				<DetailBar leading="New memory" previous={{ label: "Previous memory", icon: CH_PREVIOUS }} next={{ label: "Next memory", icon: CH_NEXT }} close={close} />
				<MemoryEditor entry={null} send={send} onSaved={slug => setOpen({ slug })} onDeleted={() => setOpen(null)} />
			</section>
		);
	} else if (entry !== null) {
		detail = (
			<section key={entry.slug} aria-label={entry.slug}>
				<DetailBar
					leading={entry.slug}
					previous={{ label: "Previous memory", icon: CH_PREVIOUS, onClick: at > 0 ? () => setOpen({ slug: memories[at - 1]!.slug }) : undefined }}
					next={{ label: "Next memory", icon: CH_NEXT, onClick: at >= 0 && at < memories.length - 1 ? () => setOpen({ slug: memories[at + 1]!.slug }) : undefined }}
					close={close}
				/>
				<MemoryEditor entry={entry} send={send} onSaved={slug => setOpen({ slug })} onDeleted={() => setOpen(null)} />
			</section>
		);
	}
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
				<RepoPicker repo={repo} repos={repos} />
				<p className="text-xs text-muted-foreground tabular-nums">
					{repo.memories.length.toLocaleString()} {repo.memories.length === 1 ? "memory" : "memories"}
				</p>
				<SearchField label="Filter memories" placeholder="Filter" query={query} onQuery={setQuery} className="w-40 min-w-0" />
				<Button variant="ghost" size="compact" leadingIcon={IconPlusSmall} className="ml-auto" onClick={() => setOpen("new")} {...activityControl("memory.project.add")}>
					New memory
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				<ListSplit
					widthKey="omp-agents.project-memory-width"
					resizeLabel="Resize the memory list"
					detailLabel="Open memory"
					empty={{ icon: IconBrain, title: "No memory open", hint: "Click a memory to read and edit it, or New memory to add one." }}
					list={list}
					detail={detail}
				/>
			</div>
		</div>
	);
}

/**
 * The open memory's kind, line, and body, saved as one change; a new one also takes its slug.
 * `onSaved` gets the slug saved, and Delete asks for a second click.
 */
function MemoryEditor({
	entry,
	send,
	onSaved,
	onDeleted,
}: {
	entry: ProjectMemoryEntry | null;
	send: (ops: ProjectMemoryOp[]) => Promise<ProjectMemoryView>;
	onSaved: (slug: string) => void;
	onDeleted: () => void;
}) {
	const ids = { slug: useId(), kind: useId(), line: useId(), body: useId() };
	const [slug, setSlug] = useState(entry?.slug ?? "");
	const [kind, setKind] = useState<ProjectMemoryKind>(entry?.kind ?? "fact");
	const [line, setLine] = useState(entry?.line ?? "");
	const [body, setBody] = useState(entry?.body ?? "");
	const saving = useSaving<"save" | "delete">();
	const confirm = useInlineConfirm(`project-memory:${entry?.slug ?? "new"}`);
	const busy = saving.saving !== null;
	const changed = entry === null || kind !== entry.kind || line !== entry.line || body !== entry.body;
	const ready = slug.trim() !== "" && line.trim() !== "" && body.trim() !== "";
	const save = (): void => {
		const name = slug.trim();
		const op: ProjectMemoryOp = { op: entry === null ? "add" : "update", slug: name, kind, line: line.trim(), body: body.trim() };
		saving.run("save", async () => {
			await send([op]);
			onSaved(name);
		});
	};
	const remove = (): void => {
		if (entry === null) return;
		saving.run("delete", async () => {
			await send([{ op: "delete", slug: entry.slug }]);
			onDeleted();
		});
	};
	return (
		<form
			aria-busy={busy}
			className={cn("mx-auto w-full max-w-3xl space-y-4 px-6 py-5 transition-opacity motion-reduce:transition-none", busy && "opacity-60")}
			onSubmit={event => {
				event.preventDefault();
				if (ready && changed && !busy) save();
			}}
		>
			{entry === null ? (
				<div className="space-y-1">
					<label htmlFor={ids.slug} className="text-sm font-medium">
						Slug
					</label>
					<input
						id={ids.slug}
						autoFocus
						value={slug}
						maxLength={48}
						placeholder="release-needs-tag"
						onChange={event => setSlug(event.target.value)}
						className={cn(FIELD, "w-full font-mono")}
					/>
					<p className="text-xs text-muted-foreground">Lowercase letters, digits, and hyphens, at most 48.</p>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Updated {dateLabel(entry.updated)} by {sourceLabel(entry.source)}
				</p>
			)}
			<div className="space-y-1">
				<span id={ids.kind} className="text-sm font-medium">
					Kind
				</span>
				<Select value={kind} disabled={busy} onValueChange={next => setKind(next as ProjectMemoryKind)}>
					<SelectTrigger aria-labelledby={ids.kind} className="w-40">
						<SelectValue>{(shown: unknown) => KIND_LABELS[shown as ProjectMemoryKind]}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{PROJECT_MEMORY_KINDS.map(each => (
							<SelectItem key={each} value={each}>
								{KIND_LABELS[each]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1">
				<div className="flex items-baseline justify-between gap-2">
					<label htmlFor={ids.line} className="text-sm font-medium">
						Line
					</label>
					<span className="text-xs text-muted-foreground tabular-nums">
						{line.length} / {LINE_MAX}
					</span>
				</div>
				<input id={ids.line} value={line} maxLength={LINE_MAX} readOnly={busy} onChange={event => setLine(event.target.value)} className={cn(FIELD, "w-full")} />
				<p className="text-xs text-muted-foreground">One self-contained line, which an agent reads in the index without the body.</p>
			</div>
			<div className="space-y-1">
				<div className="flex items-baseline justify-between gap-2">
					<label htmlFor={ids.body} className="text-sm font-medium">
						Body
					</label>
					<span className="text-xs text-muted-foreground tabular-nums">
						{body.length} / {BODY_MAX}
					</span>
				</div>
				<textarea
					id={ids.body}
					value={body}
					maxLength={BODY_MAX}
					readOnly={busy}
					rows={10}
					onChange={event => setBody(event.target.value)}
					onKeyDown={event => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					className={TEXTAREA}
				/>
			</div>
			{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
			<div className="flex items-center gap-2">
				<Button type="submit" variant="primary" size="compact" disabled={busy || !ready || !changed} loading={saving.saving === "save"} {...activityControl("memory.project.save")}>
					{entry === null ? "Add memory" : "Save"}
				</Button>
				{entry !== null && (
					<Button
						variant="destructive-outline"
						size="compact"
						className="ml-auto"
						disabled={busy}
						loading={saving.saving === "delete"}
						{...confirm.props("delete", remove)}
						{...activityControl("memory.project.delete")}
					>
						{confirm.isArmed("delete") ? "Confirm delete?" : "Delete"}
					</Button>
				)}
			</div>
		</form>
	);
}
