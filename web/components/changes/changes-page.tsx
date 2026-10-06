import { ArrowLeft, ChevronRight, RotateCw } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { ChangedEntry, ChangedFileText, SessionChanges } from "../../../src/shared/changes";
import { hashForSession, type PastSession, type RosterHost } from "../../../src/shared/sessions";
import { fileTree, treeOrder } from "../../changes-model";
import { usePane } from "../../pane-store";
import { hostLabel, pastLabel } from "../../labels";
import { useRead } from "../../reads";
import { hashForChanges } from "../../routing";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { Button } from "@/components/ui/button";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { Header } from "../page-header";
import { CodeView } from "./code-view";
import { Counts, FileTree, StatusLetter, statusLabel } from "./file-tree";

/** Diff shows the changes with unchanged runs folded; File shows the whole file as it is now, its changes marked in the gutter. */
const MODES = ["diff", "file"] as const;
type Mode = (typeof MODES)[number];
const MODE_KEY = "omp-agents.changes-mode";

type Scope = "all" | "session";

interface ChangesPageProps {
	sessionId: string;
	/** The file open, by the path the list gives it; `null` opens the first. */
	path: string | null;
	host: RosterHost | null;
	past: PastSession | null;
}

/**
 * The files a session changed, as an editor shows them: the explorer lists what its checkout changed against its branch
 * base and what its own edits changed, and the editor shows the open file's diff or the whole file with its changes marked.
 */
export function ChangesPage({ sessionId, path, host, past }: ChangesPageProps) {
	const [scope, setScope] = useState<Scope>("all");
	const [mode, setMode] = useStoredState<Mode>(MODE_KEY, raw => MODES.find(mode => mode === raw) ?? "diff");
	const [reads, setReads] = useState(0);
	// The session's own edits arrive as its `work`, so each one reads the changes again. A turn that starts or ends does
	// too: bash and subagents edit files without telling the page, and one that ended may have committed since the last read.
	const work = usePane(host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId }).files;
	const edits = work?.reduce((count, file) => count + file.changes.length, 0) ?? 0;
	const version = `${reads}:${host?.status ?? "past"}:${edits}`;
	const list = useRead<SessionChanges>(`/api/changes?session=${encodeURIComponent(sessionId)}`, version);
	const files = useMemo(() => (list.data?.files ?? []).filter(file => scope === "all" || file.session), [list.data, scope]);
	const tree = useMemo(() => fileTree(files), [files]);
	const order = useMemo(() => treeOrder(tree), [tree]);
	const entry = order.find(file => file.path === path) ?? order[0] ?? null;
	const read = useRead<ChangedFileText>(entry && `/api/changes/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(entry.path)}`, version);
	const step = (by: 1 | -1): boolean => {
		if (!entry) return false;
		const next = order[order.indexOf(entry) + by];
		if (next) location.hash = hashForChanges(sessionId, next.path);
		return true;
	};
	useShortcuts({ nextChangedFile: () => step(1), previousChangedFile: () => step(-1) });

	const label = host ? hostLabel(host) : past ? pastLabel(past) : "Session";
	const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 });
	const changes = list.data;
	const sessionCount = changes?.files.filter(file => file.session).length ?? 0;
	const meta = changes && (
		<>
			{changes.root === null ? "Not a git checkout" : `${changes.branch ?? "detached HEAD"} against ${changes.base?.ref ?? "HEAD"}`} · {files.length} {files.length === 1 ? "file" : "files"}{" "}
			<Counts added={totals.added} removed={totals.removed} />
		</>
	);
	const back = (
		<Tooltip content={`Back to ${label}`} side="bottom">
			<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label={`Back to ${label}`} asChild>
				<a href={hashForSession(sessionId)}>
					<ArrowLeft />
				</a>
			</Button>
		</Tooltip>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title={`Changes · ${label}`} meta={meta ?? "Reading changes…"} status={list.error ?? undefined} alert={list.error !== null} leading={back}>
				<SizeProvider size="compact">
					<Tabs value={scope} onValueChange={value => setScope(value as Scope)}>
						<TabsList aria-label="Which changes">
							<TabItem value="all" label="All changes" badge={changes?.files.length || undefined} />
							<TabItem value="session" label="This session" badge={sessionCount || undefined} tooltip="The files this session's own edit and write calls changed" />
						</TabsList>
					</Tabs>
				</SizeProvider>
				<Tooltip content="Read the changes again" side="bottom">
					<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Read the changes again" onClick={() => setReads(count => count + 1)}>
						<RotateCw />
					</Button>
				</Tooltip>
			</Header>
			{!changes ? (
				!list.error && <p className="m-auto text-sm text-muted-foreground">Reading changes…</p>
			) : files.length === 0 ? (
				<p className="m-auto text-sm text-muted-foreground">
					{scope === "session" ? "This session's own calls changed no file." : changes.root === null ? "The session changed no file." : "Nothing changed against the base."}
				</p>
			) : (
				<div className="flex min-h-0 flex-1">
					<nav aria-label="Changed files" className="flex w-72 shrink-0 flex-col border-r border-border">
						<p className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
							<kbd>{shortcutLabels("nextChangedFile")[0]}</kbd> and <kbd>{shortcutLabels("previousChangedFile")[0]}</kbd> step through the files
						</p>
						<div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
							<FileTree tree={tree} open={entry?.path ?? null} sessionId={sessionId} />
						</div>
					</nav>
					{entry && (
						<section aria-label={entry.path} className="flex min-w-0 flex-1 flex-col">
							<div className="flex items-center gap-3 border-b border-border px-4 py-1.5">
								<StatusLetter file={entry} />
								<p className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs text-muted-foreground" title={`${entry.path}: ${statusLabel(entry)}`}>
									{entry.path.split("/").map((part, index, parts) => (
										<Fragment key={index}>
											{index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0" />}
											<span className={index === parts.length - 1 ? "truncate text-foreground" : "shrink-0"}>{part}</span>
										</Fragment>
									))}
								</p>
								<Counts added={entry.added} removed={entry.removed} />
								<SizeProvider size="compact">
									<Tabs value={mode} onValueChange={value => setMode(value as Mode)}>
										<TabsList aria-label="Show">
											<TabItem value="diff" label="Diff" tooltip="The changes, with unchanged lines folded" />
											<TabItem value="file" label="File" tooltip="The whole file as it is now, its changes marked in the gutter" />
										</TabsList>
									</Tabs>
								</SizeProvider>
							</div>
							{/* Keyed by file, so unfolded runs and shown removals start closed in the next one. */}
							<CodeView key={entry.path} mode={mode} file={read.data} error={read.error} />
						</section>
					)}
				</div>
			)}
		</div>
	);
}
