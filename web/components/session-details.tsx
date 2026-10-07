import { FileDiff, FileMinus, FilePen, FilePlus, Images, type LucideIcon, TableOfContents } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { type ChangedFile, type FileChange, type FileChangeKind, type FileStatus, fileStatus, lineTotals, parseDiffLine } from "../../src/shared/transcript";
import { SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { age, readTime } from "../labels";
import { usePane } from "../pane-store";
import { hashForChanges } from "../routing";
import { useStoredState } from "../stored-state";
import { outline } from "../transcript-view";
import { MediaTab } from "./media-tab";
import { OutlineTab } from "./outline-tab";

const CHANGE_LABEL: Record<FileChangeKind, string> = { created: "Created", edited: "Edited", rewritten: "Rewritten", deleted: "Deleted" };

/** omp's numbered diff, `+12|added`, `-12|removed`, ` 12|context`, with blank lines between hunks, in the flow of the list. */
function Diff({ diff }: { diff: string }) {
	return (
		<div className="font-mono text-[11px] leading-4" data-diff>
			{diff.split("\n").map((line, index) => {
				const parsed = parseDiffLine(line);
				if (!parsed) return <div key={index} className="h-2" aria-hidden />;
				const { sign, number, text } = parsed;
				return (
					<div
						key={index}
						className={cn(
							"flex",
							sign === "+" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : sign === "-" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-muted-foreground",
						)}
					>
						<span className="w-10 shrink-0 pr-1.5 text-right opacity-60 select-none">{number}</span>
						<span className="w-3 shrink-0 select-none">{sign}</span>
						<span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{text || " "}</span>
					</div>
				);
			})}
		</div>
	);
}

/** `+12 −3`, the lines added and removed. */
function LineCounts({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="shrink-0 whitespace-nowrap tabular-nums" aria-label={`${added} added, ${removed} removed`}>
			<span className="text-emerald-600 dark:text-emerald-400">+{added}</span> <span className="text-red-600 dark:text-red-400">−{removed}</span>
		</span>
	);
}

const lines = (count: number): string => `${count} ${count === 1 ? "line" : "lines"}`;

/** A change's kind and time, then what it recorded: an edit's line counts and diff, or how many lines a write wrote. */
function Change({ change }: { change: FileChange }) {
	let counts: ReactNode;
	let body: ReactNode;
	switch (change.tool) {
		case "edit":
			counts = <LineCounts added={change.added} removed={change.removed} />;
			body = change.diff && <Diff diff={change.diff} />;
			break;
		case "write":
			counts = change.lines !== null && <span className="tabular-nums">{lines(change.lines)}</span>;
			body = <p className="text-xs text-muted-foreground">Written whole, so omp recorded no diff.</p>;
			break;
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
	return (
		<li className="space-y-1">
			<p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">{CHANGE_LABEL[change.kind]}</span>
				{change.at !== null && <time dateTime={new Date(change.at).toISOString()}>{readTime(change.at)}</time>}
				<span className="flex-1" />
				{counts}
			</p>
			{body}
		</li>
	);
}

const FILE_LOOK: Record<FileStatus, { icon: LucideIcon; label: string }> = {
	created: { icon: FilePlus, label: "New file" },
	edited: { icon: FilePen, label: "Edited" },
	deleted: { icon: FileMinus, label: "Deleted" },
};

function FileRow({ file }: { file: ChangedFile }) {
	const [open, setOpen] = useState(false);
	const slash = file.path.lastIndexOf("/");
	const name = file.path.slice(slash + 1);
	const dir = slash > 0 ? file.path.slice(0, slash) : "";
	const { changes } = file;
	const look = FILE_LOOK[fileStatus(changes)];
	const last = changes[changes.length - 1].at;
	const summary = [look.label, `${changes.length} ${changes.length === 1 ? "change" : "changes"}`, last !== null && `${age(last)} ago`].filter(Boolean).join(" · ");
	return (
		<SidebarMenuItem>
			<Tooltip content={`${file.path} · ${summary}`} side="left">
				<SidebarMenuButton icon={look.icon} aria-expanded={open} onClick={() => setOpen(!open)} className="h-auto min-h-8 items-start py-1.5 [&>svg]:mt-0.5">
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex min-w-0 items-baseline gap-1.5">
							<span className="min-w-0 truncate text-foreground">{name}</span>
							<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
							<span className="text-xs">
								<LineCounts {...lineTotals(changes)} />
							</span>
						</span>
						<span className="truncate text-xs text-muted-foreground">{summary}</span>
					</span>
				</SidebarMenuButton>
			</Tooltip>
			{open && (
				<ol className="space-y-3 border-l border-border py-2 pr-1 pl-3 ml-4" aria-label={`Changes to ${file.path}, newest first`}>
					{changes.toReversed().map((change, index) => (
						<Change key={changes.length - index} change={change} />
					))}
				</ol>
			)}
		</SidebarMenuItem>
	);
}

/** The right sidebar's tab, which localStorage keeps across views. The key keeps its old name, and a tab that no longer exists reads as the outline. */
const TAB_KEY = "omp-agents.plan-tab";

const DETAILS_TABS = ["outline", "files", "media"] as const;
type DetailsTab = (typeof DETAILS_TABS)[number];

/** Each tab names itself and counts its items in a badge, which screen readers hear through the tab's name. */
function tabLabel(name: string, count: number): { label: string; badge: number | undefined; "aria-label": string | undefined } {
	return count > 0 ? { label: name, badge: count, "aria-label": `${name} (${count})` } : { label: name, badge: undefined, "aria-label": undefined };
}

/** The labeled tabs fit the sidebar's default width only with tighter padding than Fluid's, and only without their icons. */
const TAB_CLASS = "px-2 @max-[23rem]/sidebar:[&>svg]:hidden";

/** Keeps each tab's content off the header's hairline at rest, and scrolls away with it. */
const PANEL_VIEWPORT = "pt-2";

/**
 * The right sidebar's content for the focused view: an outline of its conversation's turns, the files its agent changed,
 * and the images its agents' tools returned, each tab apart. `working` marks the last turn as still running, and
 * `sessionId` names the session whose changes page the Files tab links to, `null` for a subagent's view.
 */
export function SessionDetails({ view, working, sessionId }: { view: View; working: boolean; sessionId: string | null }) {
	const { items, loaded, files: changedFiles, media } = usePane(view);
	const [tab, setTab] = useStoredState<DetailsTab>(TAB_KEY, raw => DETAILS_TABS.find(tab => tab === raw) ?? "outline");
	const turns = useMemo(() => outline(items, working), [items, working]);
	const files = changedFiles ?? [];
	return (
		<Tabs value={tab} onValueChange={value => setTab(value as DetailsTab)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-2 border-b border-border px-2 py-3">
				<h2 className="sr-only">Session details</h2>
				<SizeProvider size="compact">
					<TabsList aria-label="Session details">
						<TabItem value="outline" icon={TableOfContents} className={TAB_CLASS} {...tabLabel("Outline", turns.length)} />
						<TabItem value="files" icon={FileDiff} className={TAB_CLASS} {...tabLabel("Files", files.length)} />
						<TabItem value="media" icon={Images} className={TAB_CLASS} {...tabLabel("Media", media?.length ?? 0)} />
					</TabsList>
				</SizeProvider>
			</SidebarHeader>
			<TabPanel value="outline" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<OutlineTab turns={turns} loaded={loaded} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="files" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					{changedFiles && files.length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">No file changes yet.</p>}
					{files.length > 0 && (
						<SidebarGroup>
							<SidebarGroupLabel>
								<span className="min-w-0 flex-1 truncate">
									{files.length} {files.length === 1 ? "file" : "files"} changed
								</span>
								<LineCounts {...lineTotals(files.flatMap(file => file.changes))} />
							</SidebarGroupLabel>
							<SidebarMenu aria-label="Files changed">
								{files.map(file => (
									<FileRow key={file.path} file={file} />
								))}
							</SidebarMenu>
						</SidebarGroup>
					)}
					{sessionId !== null && (
						<SidebarGroup>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton asChild>
										<a href={hashForChanges(sessionId)}>
											<FileDiff />
											<span>Open the session's changes</span>
										</a>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroup>
					)}
				</SidebarContent>
			</TabPanel>
			<TabPanel value="media" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<MediaTab media={media} view={view} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
