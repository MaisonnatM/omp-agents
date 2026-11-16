/** The session details sidebar's **Diffs** tab: what the session's checkout changed against its branch base, a row per file that opens that file's diff. */
import { IconArrowLeft, IconArrowRotateClockwise, IconBranch, IconChevronRight } from "central-icons";
import { useMemo, useState } from "react";
import type { ChangedEntry, SessionChanges } from "../../src/shared/changes";
import { Button } from "@/components/ui/button";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { fileTree, shortPaths, treeOrder } from "../changes-model";
import { useRead } from "../reads";
import { DiffView } from "./changes/code-view";
import { DiffReviewContext, type DiffReview } from "./changes/diff-review";
import { StatusLetter, statusLabel } from "./changes/file-tree";
import { LineCounts } from "./line-counts";
import { LoadNote } from "./sheet-details";

type Scope = "all" | "session";

/** A sidebar column is narrow, so its diffs wrap long lines instead of scrolling sideways. */
const NARROW: DiffReview = { options: { layout: "stacked", wrap: true, ignoreWhitespace: false }, LineComment: null, FileHeader: null };

interface SessionDiffsTabProps {
	sessionId: string;
	/** A turn that starts or ends reads the changes again. */
	working: boolean;
}

export function SessionDiffsTab({ sessionId, working }: SessionDiffsTabProps) {
	const [scope, setScope] = useState<Scope>("all");
	const [reads, setReads] = useState(0);
	const version = `${reads}:${working}`;
	const list = useRead<SessionChanges>(`/api/changes?session=${encodeURIComponent(sessionId)}`, version);
	const changes = list.data;
	const files = useMemo(() => (changes?.files ?? []).filter(file => scope === "all" || file.session), [changes, scope]);
	const order = useMemo(() => treeOrder(fileTree(files)), [files]);
	const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 });
	const fileUrl = (path: string): string => `/api/changes/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`;
	const sessionCount = changes?.files.filter(file => file.session).length ?? 0;

	return (
		<DiffReviewContext.Provider value={NARROW}>
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="space-y-1.5 border-b border-border px-3 py-2">
					<div className="flex min-w-0 items-center gap-1.5">
						<IconBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
						<p className="min-w-0 flex-1 truncate text-[13px]" title={changes?.base ? `${changes.branch ?? "detached HEAD"} against ${changes.base.ref}` : undefined}>
							<span className="font-medium">{changes ? (changes.root === null ? "Not a git checkout" : (changes.branch ?? "detached HEAD")) : "Changes"}</span>
							{changes?.base && <span className="text-muted-foreground"> against {changes.base.ref}</span>}
						</p>
						<Tooltip content="Read the changes again" side="bottom">
							<Button variant="ghost" size="icon-compact" className="-my-1 text-muted-foreground" aria-label="Read the changes again" loading={list.refreshing} onClick={() => setReads(count => count + 1)}>
								<IconArrowRotateClockwise />
							</Button>
						</Tooltip>
					</div>
					{changes && changes.files.length > 0 && (
						<div className="flex items-center gap-2">
							<SizeProvider size="compact">
								<Tabs value={scope} onValueChange={value => setScope(value as Scope)}>
									<TabsList aria-label="Which changes">
										<TabItem value="all" label="All" badge={changes.files.length} />
										<TabItem value="session" label="Mine" badge={sessionCount || undefined} tooltip="The files this session's own edit and write calls changed" />
									</TabsList>
								</Tabs>
							</SizeProvider>
							<span className="ml-auto text-xs">
								<LineCounts added={totals.added} removed={totals.removed} />
							</span>
						</div>
					)}
				</div>
				{!changes ? (
					<div className="px-3 py-3">
						<LoadNote loading="Reading changes…" error={list.error && `Cannot load the changes: ${list.error}`} />
					</div>
				) : order.length === 0 ? (
					<p className="m-auto px-6 text-center text-sm text-muted-foreground">
						{scope === "session" ? "This session's own calls changed no file." : changes.root === null ? "The session changed no file." : "Nothing changed against the base."}
					</p>
				) : (
					<DrillInList files={order} fileUrl={fileUrl} version={version} />
				)}
			</div>
		</DiffReviewContext.Provider>
	);
}

interface ListProps {
	files: ChangedEntry[];
	fileUrl: (path: string) => string;
	version: string;
}

/** A row per file; picking one swaps the list for that file's diff, with a back button and Previous and Next to step through the files. */
function DrillInList({ files, fileUrl, version }: ListProps) {
	const [openPath, setOpenPath] = useState<string | null>(null);
	const labels = shortPaths(files.map(file => file.path));
	// A refresh or the Mine filter can drop the open file; the list shows again then.
	const at = files.findIndex(file => file.path === openPath);
	const open = files[at];
	if (open) {
		return (
			<section aria-label={open.path} className="flex min-h-0 flex-1 flex-col">
				<div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
					<Button variant="ghost" size="icon-compact" aria-label="Back to the files" onClick={() => setOpenPath(null)}>
						<IconArrowLeft />
					</Button>
					<StatusLetter file={open} />
					<p className="min-w-0 flex-1 truncate font-mono text-xs" title={`${open.path}: ${statusLabel(open)}`}>
						{open.path}
					</p>
					<LineCounts added={open.added} removed={open.removed} />
					<span className="px-1 text-xs tabular-nums text-muted-foreground">
						{at + 1}/{files.length}
					</span>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<DiffView key={open.path} path={open.path} url={fileUrl(open.path)} version={version} />
				</div>
				<div className="flex justify-between border-t border-border px-2 py-1">
					<Button variant="ghost" size="compact" disabled={at === 0} onClick={() => setOpenPath(files[at - 1]!.path)}>
						Previous
					</Button>
					<Button variant="ghost" size="compact" disabled={at === files.length - 1} onClick={() => setOpenPath(files[at + 1]!.path)}>
						Next
					</Button>
				</div>
			</section>
		);
	}
	return (
		<ul aria-label="Changed files" className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
			{files.map((file, index) => (
				<li key={file.path}>
					<button type="button" onClick={() => setOpenPath(file.path)} className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-muted" title={`${file.path}: ${statusLabel(file)}`}>
						<StatusLetter file={file} />
						<span className="truncate">{labels[index]!.name}</span>
						<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{labels[index]!.dir}</span>
						<LineCounts added={file.added} removed={file.removed} />
						<IconChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
					</button>
				</li>
			))}
		</ul>
	);
}
