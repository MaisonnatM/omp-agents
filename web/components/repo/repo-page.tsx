import { RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChangedFileText } from "../../../src/shared/changes";
import { everyWord } from "../../../src/shared/every-word";
import type { RepoFiles } from "../../../src/shared/repo-files";
import { fileTree } from "../../file-tree";
import { folderName } from "../../labels";
import { useRead } from "../../reads";
import { hashForRepo } from "../../routing";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CodeView } from "../code-view";
import { FileTree, PathCrumbs } from "../file-tree";
import { Header } from "../page-header";
import { SidebarSearch } from "../sidebar-search";

/** The most files a filter shows, so a short query over a large checkout does not draw tens of thousands of rows. */
const MAX_FOUND = 500;

interface RepoPageProps {
	/** A directory of the checkout, absolute or `~/…`. */
	dir: string;
	/** The file open, by its path from the checkout's root; `null` opens none. */
	path: string | null;
}

/**
 * Every file of the git checkout `dir` is in, read only: the explorer lists them as folders, closed until opened, or
 * the files a filter matches, and the editor shows the open file whole.
 */
export function RepoPage({ dir, path }: RepoPageProps) {
	const [reads, setReads] = useState(0);
	const [query, setQuery] = useState("");
	const list = useRead<RepoFiles>(`/api/repo?cwd=${encodeURIComponent(dir)}`, reads);
	const read = useRead<ChangedFileText>(path === null ? null : `/api/repo/file?cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`, reads);
	const repo = list.data;
	const files = useMemo(() => (repo?.files ?? []).map(file => ({ path: file })), [repo]);
	const filtering = query.trim() !== "";
	const shown = useMemo(() => {
		if (!filtering) return { files, hidden: 0 };
		const holds = everyWord(query);
		const matched = files.filter(file => holds(file.path));
		return { files: matched.slice(0, MAX_FOUND), hidden: Math.max(matched.length - MAX_FOUND, 0) };
	}, [files, query, filtering]);
	const tree = useMemo(() => fileTree(shown.files), [shown.files]);

	const meta = repo && (
		<>
			{repo.branch ?? "detached HEAD"} · {repo.files.length} {repo.files.length === 1 ? "file" : "files"} · {repo.rootDisplay}
		</>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header
				title={`Files · ${folderName(repo?.rootDisplay ?? dir) ?? dir}`}
				meta={meta ?? (list.error ? undefined : "Reading files…")}
				status={list.error ?? undefined}
				alert={list.error !== null}
			>
				<Tooltip content="Read the files again" side="bottom">
					<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Read the files again" loading={list.refreshing} onClick={() => setReads(count => count + 1)}>
						<RotateCw />
					</Button>
				</Tooltip>
			</Header>
			{!repo ? (
				!list.error && <p className="m-auto text-sm text-muted-foreground">Reading files…</p>
			) : (
				<div className="flex min-h-0 flex-1">
					<nav aria-label="Files" className="flex w-72 shrink-0 flex-col border-r border-border">
						<div className="px-2 pt-3 pb-1">
							<SidebarSearch label="Filter the files" placeholder="Search files" query={query} onQuery={setQuery} />
						</div>
						<div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
							{filtering && shown.files.length === 0 ? (
								<p className="px-2 py-2 text-xs text-muted-foreground">{`No files match “${query.trim()}”`}</p>
							) : (
								<FileTree tree={tree} open={path} hrefFor={file => hashForRepo(dir, file)} startClosed={!filtering} />
							)}
							{shown.hidden > 0 && <p className="px-2 py-2 text-xs text-muted-foreground">{`${shown.hidden} more match; type more to narrow`}</p>}
						</div>
					</nav>
					{path === null ? (
						<p className="m-auto text-sm text-muted-foreground">Pick a file</p>
					) : (
						<section aria-label={path} className="flex min-w-0 flex-1 flex-col">
							<div className="flex items-center gap-3 border-b border-border px-4 py-1.5">
								<PathCrumbs path={path} title={path} />
							</div>
							<CodeView key={path} mode="file" file={read.data} error={read.error} />
						</section>
					)}
				</div>
			)}
		</div>
	);
}
