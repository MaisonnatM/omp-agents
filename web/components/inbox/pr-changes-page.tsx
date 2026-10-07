import { ArrowLeft, RotateCw } from "lucide-react";
import { useState } from "react";
import type { PullRequest, PullRequestChanges } from "../../../src/shared/github";
import { useRead } from "../../reads";
import { hashForInbox, hashForPullRequestFiles } from "../../routing";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ChangesExplorer } from "../changes/changes-explorer";
import { Counts } from "../changes/file-tree";
import { Header } from "../page-header";

interface PullRequestChangesPageProps {
	pr: PullRequest;
	/** The file open, by the path the list gives it; `null` opens the first. */
	path: string | null;
}

/** The files a pull request changes, as the session changes page shows a session's, read from GitHub. */
export function PullRequestChangesPage({ pr, path }: PullRequestChangesPageProps) {
	const [reads, setReads] = useState(0);
	const query = `owner=${encodeURIComponent(pr.owner)}&repo=${encodeURIComponent(pr.repo)}&number=${pr.number}`;
	const list = useRead<PullRequestChanges>(`/api/pull-request/files?${query}`, reads);
	const changes = list.data;
	const files = changes?.files ?? [];
	const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 });
	const meta = changes && (
		<>
			{changes.head} into {changes.base} · {files.length} {files.length === 1 ? "file" : "files"} <Counts added={totals.added} removed={totals.removed} />
		</>
	);
	const label = `Back to #${pr.number}`;
	const back = (
		<Tooltip content={label} side="bottom">
			<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label={label} asChild>
				<a href={hashForInbox(pr)}>
					<ArrowLeft />
				</a>
			</Button>
		</Tooltip>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title={`Changes · #${pr.number}${changes ? ` ${changes.title}` : ""}`} meta={meta ?? "Reading changes…"} status={list.error ?? undefined} alert={list.error !== null} leading={back}>
				<Tooltip content="Read the changes again" side="bottom">
					<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Read the changes again" onClick={() => setReads(count => count + 1)}>
						<RotateCw />
					</Button>
				</Tooltip>
			</Header>
			{!changes ? (
				!list.error && <p className="m-auto text-sm text-muted-foreground">Reading changes…</p>
			) : files.length === 0 ? (
				<p className="m-auto text-sm text-muted-foreground">The pull request changes no file.</p>
			) : (
				<ChangesExplorer
					files={files}
					path={path}
					hrefFor={file => hashForPullRequestFiles(pr, file)}
					fileUrl={file => `/api/pull-request/file?${query}&path=${encodeURIComponent(file)}`}
					version={reads}
				/>
			)}
		</div>
	);
}
