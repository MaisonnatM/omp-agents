/** `PullRequestFilesDialog`: a pull request's changed files over the page, opened at one file. */
import { useState } from "react";
import type { PullRequest, PullRequestChanges } from "../../../src/shared/github";
import { useRead } from "../../reads";
import { hashForPullRequestFiles } from "../../routing";
import { ChangesExplorer } from "../changes/changes-explorer";
import { ExplorerDialog } from "../changes/explorer-dialog";
import { LoadNote } from "../sheet-details";

/** `pr`'s changed files over the page, as its Code tab shows them, opened at `path`; another file opens in place. */
export function PullRequestFilesDialog({ pr, title, path, version, onClose }: { pr: PullRequest; title: string; path: string; version?: unknown; onClose: () => void }) {
	const [open, setOpen] = useState(path);
	const query = new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) });
	const list = useRead<PullRequestChanges>(`/api/pull-request/files?${query}`, version);
	return (
		<ExplorerDialog
			title={
				<>
					<span className="text-muted-foreground tabular-nums">#{pr.number}</span> {title}
				</>
			}
			onClose={onClose}
		>
			{list.data && list.data.files.length > 0 ? (
				<ChangesExplorer
					files={list.data.files}
					path={open}
					hrefFor={file => hashForPullRequestFiles(pr, file)}
					onPick={setOpen}
					fileUrl={file => `/api/pull-request/file?${query}&path=${encodeURIComponent(file)}`}
					version={String(version ?? 0)}
				/>
			) : (
				<div className="px-4 py-3">
					{list.data ? <p className="text-sm text-muted-foreground">The pull request changes no file.</p> : <LoadNote loading="Reading changes…" error={list.error && `Cannot load the changes: ${list.error}`} />}
				</div>
			)}
		</ExplorerDialog>
	);
}
