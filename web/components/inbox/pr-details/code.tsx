import { useState } from "react";
import type { PullRequest, PullRequestChanges, PullRequestDetail } from "../../../../src/shared/github";
import { useRead } from "../../../reads";
import { hashForPullRequestFiles } from "../../../routing";
import { ChangesExplorer } from "../../changes/changes-explorer";
import { LoadNote } from "../../sheet-details";
import { PullRequestFilesDialog } from "../pr-files-dialog";
import type { Placement } from ".";

/** The Code tab: on the page, the changes explorer; in the narrow sidebar, the files, each opening its diff over the page. */
export function Code({ pr, detail, placement, path, version }: { pr: PullRequest; detail: PullRequestDetail; placement: Placement; path: string | null; version?: unknown }) {
	const query = `owner=${encodeURIComponent(pr.owner)}&repo=${encodeURIComponent(pr.repo)}&number=${pr.number}`;
	const list = useRead<PullRequestChanges>(placement === "page" ? `/api/pull-request/files?${query}` : null, version);
	const [shown, setShown] = useState<string | null>(null);
	if (placement === "sidebar") {
		return (
			<>
				<ul className="divide-y divide-border rounded-lg border border-border font-mono text-xs">
					{detail.files.map(file => (
						<li key={file.path}>
							<button type="button" onClick={() => setShown(file.path)} className="flex w-full min-w-0 items-center gap-3 px-2.5 py-1 text-left hover:bg-muted">
								<span className="min-w-0 flex-1 truncate">{file.path}</span>
								<span className="shrink-0 tabular-nums">
									<span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span> <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
				{shown !== null && <PullRequestFilesDialog pr={pr} title={detail.title} path={shown} version={version} onClose={() => setShown(null)} />}
			</>
		);
	}
	if (!list.data) {
		return (
			<div className="px-6 py-4">
				<LoadNote loading="Reading changes…" error={list.error && `Cannot load the changes: ${list.error}`} />
			</div>
		);
	}
	if (list.data.files.length === 0) return <p className="m-auto text-sm text-muted-foreground">The pull request changes no file.</p>;
	return (
		<ChangesExplorer
			files={list.data.files}
			path={path}
			hrefFor={file => hashForPullRequestFiles(pr, file)}
			fileUrl={file => `/api/pull-request/file?${query}&path=${encodeURIComponent(file)}`}
			version={String(version ?? 0)}
		/>
	);
}
