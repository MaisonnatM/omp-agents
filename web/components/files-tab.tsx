import { FileDiff, FileMinus, FilePen, FilePlus, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type ChangedFile, type FileChange, type FileChangeKind, type FileStatus, fileStatus, lineTotals, parseDiffLine } from "../../src/shared/transcript";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { everyWord } from "../../src/shared/every-word";
import { age, readTime } from "../labels";
import { hashForChanges } from "../routing";
import { LineCounts } from "./line-counts";
import { SidebarSearch } from "./sidebar-search";
import { ViewerDialog } from "./viewer-dialog";

const CHANGE_LABEL: Record<FileChangeKind, string> = { created: "Created", edited: "Edited", rewritten: "Rewritten", deleted: "Deleted" };

/** omp's numbered diff, `+12|added`, `-12|removed`, ` 12|context`, with blank lines between hunks. */
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

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
			counts = change.lines !== null && <span className="shrink-0 font-mono text-[11px] whitespace-nowrap tabular-nums">{plural(change.lines, "line")}</span>;
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

interface FileLook {
	icon: LucideIcon;
	label: string;
}

const FILE_LOOK: Record<FileStatus, FileLook> = {
	created: { icon: FilePlus, label: "New file" },
	edited: { icon: FilePen, label: "Edited" },
	deleted: { icon: FileMinus, label: "Deleted" },
};

/** A changed file's name, its folder, its look, and the line under its name: what happened, how often, and when last. */
function factsOf(file: ChangedFile): { name: string; dir: string; look: FileLook; summary: string } {
	const slash = file.path.lastIndexOf("/");
	const { changes } = file;
	const look = FILE_LOOK[fileStatus(changes)];
	const last = changes[changes.length - 1].at;
	const summary = [look.label, plural(changes.length, "change"), last !== null && `${age(last)} ago`].filter(Boolean).join(" · ");
	return { name: file.path.slice(slash + 1), dir: slash > 0 ? file.path.slice(0, slash) : "", look, summary };
}

function FileRow({ file, onOpen }: { file: ChangedFile; onOpen: () => void }) {
	const { name, dir, look, summary } = factsOf(file);
	return (
		<SidebarMenuItem>
			<Tooltip content={`${file.path} · ${summary}`} side="left">
				<SidebarMenuButton icon={look.icon} aria-haspopup="dialog" onClick={onOpen} className="h-auto min-h-8 items-start py-1.5 [&>svg]:mt-0.5">
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex min-w-0 items-baseline gap-1.5">
							<span className="min-w-0 truncate text-foreground">{name}</span>
							<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
							<LineCounts {...lineTotals(file.changes)} />
						</span>
						<span className="truncate text-xs text-muted-foreground">{summary}</span>
					</span>
				</SidebarMenuButton>
			</Tooltip>
		</SidebarMenuItem>
	);
}

/** One file's changes over the page, newest first, each with what omp recorded; it follows the file while the agent edits it. */
function FileChangesDialog({ file, onClose }: { file: ChangedFile; onClose: () => void }) {
	const { name, look, summary } = factsOf(file);
	const { changes } = file;
	return (
		<ViewerDialog
			icon={look.icon}
			title={name}
			description={`${file.path} · ${summary}`}
			actions={<LineCounts {...lineTotals(changes)} />}
			bodyLabel={`Changes to ${file.path}, newest first`}
			onClose={onClose}
		>
			<ol className="space-y-5 p-4">
				{changes.toReversed().map((change, index) => (
					<Change key={changes.length - index} change={change} />
				))}
			</ol>
		</ViewerDialog>
	);
}

/** The changed files, with a search that keeps those whose path holds every word typed; the heading counts and totals what it shows. */
function ChangedFiles({ files, onOpen }: { files: ChangedFile[]; onOpen: (path: string) => void }) {
	const [query, setQuery] = useState("");
	const holds = everyWord(query);
	const matched = files.filter(file => holds(file.path));
	const count = matched.length === files.length ? plural(files.length, "file") : `${matched.length} of ${plural(files.length, "file")}`;
	return (
		<SidebarGroup>
			<SidebarSearch label="Filter the changed files" placeholder="Search files" query={query} onQuery={setQuery} />
			{matched.length === 0 ? (
				<p className="px-2 py-2 text-xs text-muted-foreground">{`No files match “${query.trim()}”`}</p>
			) : (
				<>
					<SidebarGroupLabel>
						<span className="min-w-0 flex-1 truncate">{count} changed</span>
						<LineCounts {...lineTotals(matched.flatMap(file => file.changes))} />
					</SidebarGroupLabel>
					<SidebarMenu aria-label="Files changed">
						{matched.map(file => (
							<FileRow key={file.path} file={file} onOpen={() => onOpen(file.path)} />
						))}
					</SidebarMenu>
				</>
			)}
		</SidebarGroup>
	);
}

/** The files the view's agent changed, in first-touch order, each opening its changes in a dialog, then a link to the session's changes page. */
export function FilesTab({ files, sessionId }: { files: ChangedFile[] | null; sessionId: string | null }) {
	const [shownPath, setShownPath] = useState<string | null>(null);
	const shown = shownPath === null ? undefined : files?.find(file => file.path === shownPath);
	return (
		<>
			{files &&
				(files.length === 0 ? <p className="px-4 py-2 text-sm text-muted-foreground">No file changes yet.</p> : <ChangedFiles files={files} onOpen={setShownPath} />)}
			{shown && <FileChangesDialog file={shown} onClose={() => setShownPath(null)} />}
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
		</>
	);
}
