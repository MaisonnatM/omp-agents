import { useMemo, useState } from "react";
import { type PullRequest, type PullRequestChanges, type PullRequestDetail, pullRequestUrl } from "../../../../src/shared/github";
import { reviewDraftOf } from "../../../../src/shared/review-drafts";
import { Button } from "@/components/ui/button";
import { lineCommentsBlocked } from "../../../pull-requests-model";
import { useRead } from "../../../reads";
import { hashForPullRequestFiles } from "../../../routing";
import { AskAboutSelection } from "../../ask-about-selection";
import { type DiffReview, DiffReviewContext } from "../../changes/diff-review";
import { useCollapsedFiles } from "../../changes/diff-stack";
import { useDashboardActions, useDashboardStatus } from "../../dashboard-context";
import { CodeFiles } from "./code-files";
import { CodeToolbar } from "./code-toolbar";
import { type CodeControls, CodeControlsContext, LineCommentBox } from "./diff-controls";
import { useDiffPreferences } from "./diff-preferences";
import { useViewedFiles, ViewedFilesContext, ViewedToggle } from "./viewed-files";
import type { Placement } from ".";

interface CodeProps {
	pr: PullRequest;
	detail: PullRequestDetail;
	placement: Placement;
	path: string | null;
	version?: unknown;
}

/** The **Code** tab of one pull request; its parent keys it on the pull request, so another one starts it afresh. */
export function Code({ pr, detail, placement, path, version }: CodeProps) {
	const [requested, setRequested] = useState<string | null>(null);
	const [sidebarPath, setSidebarPath] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const commit = detail.commits.some(entry => entry.oid === requested) ? requested : null;
	const preferences = useDiffPreferences();
	const { collapsed, setCollapsed, onCollapse } = useCollapsedFiles();
	const { request } = useDashboardActions();
	const draft = reviewDraftOf(useDashboardStatus().reviewDrafts, pr);
	const query = new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number), ...(commit ? { commit } : {}) });
	const list = useRead<PullRequestChanges>(`/api/pull-request/files?${query}`, `${String(version)}:${retry}`);
	const files = list.data?.files;
	const { viewedFiles, viewedCount, saveError } = useViewedFiles(pr, files, onCollapse);
	const blocked = lineCommentsBlocked(commit, draft, detail.headOid);
	const commentable = blocked === null;
	const { options } = preferences;
	const review = useMemo((): DiffReview => ({ options, LineComment: commentable ? LineCommentBox : null, FileHeader: ViewedToggle }), [options, commentable]);
	const controls: CodeControls = {
		addComment: (file, comment) => request({ t: "review-draft", change: { op: "add-finding", pr, head: detail.headOid, finding: { path: file, ...comment } } }),
	};
	const allCollapsed = !!files?.length && files.every(file => collapsed.has(file.path));
	return (
		<>
			<CodeToolbar
				commits={detail.commits}
				commit={commit}
				onCommit={setRequested}
				viewed={files ? { count: viewedCount, total: files.length } : null}
				preferences={preferences}
				allCollapsed={allCollapsed}
				onCollapseAll={() => setCollapsed(new Set(allCollapsed ? [] : files?.map(file => file.path)))}
			/>
			{saveError && (
				<p role="alert" className="px-4 py-2 text-xs text-destructive">
					Could not save viewed state: {saveError}
				</p>
			)}
			{blocked && <p className="px-4 py-1 text-xs text-muted-foreground">{blocked}</p>}
			{!files ? (
				<div className="m-auto space-y-3 p-6 text-center text-sm text-muted-foreground">
					<p>{list.error ? "Could not load pull request diff" : "Loading pull request diff..."}</p>
					{list.error && (
						<>
							<p>{list.error}</p>
							<Button size="xs" variant="outline" onClick={() => setRetry(value => value + 1)}>
								Try again
							</Button>
							<a className="ml-3 underline" href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
								Open on GitHub
							</a>
						</>
					)}
				</div>
			) : files.length === 0 ? (
				<p className="m-auto p-6 text-sm text-muted-foreground">This {commit ? "commit" : "pull request"} has no file changes.</p>
			) : (
				<AskAboutSelection origin={{ source: `pull request ${pr.owner}/${pr.repo}#${pr.number} “${detail.title}”`, sendToSession: null }}>
					<DiffReviewContext.Provider value={review}>
						<CodeControlsContext.Provider value={controls}>
							<ViewedFilesContext.Provider value={viewedFiles}>
								<CodeFiles
									key={commit ?? "all"}
									files={files}
									path={placement === "page" ? path : sidebarPath}
									{...(placement === "page" ? { hrefFor: (file: string) => hashForPullRequestFiles(pr, file) } : { onPick: setSidebarPath })}
									fileUrl={file => `/api/pull-request/file?${query}&path=${encodeURIComponent(file)}`}
									version={String(version ?? 0)}
									treeOpen={preferences.treeOpen}
									collapsed={collapsed}
									onCollapse={onCollapse}
								/>
							</ViewedFilesContext.Provider>
						</CodeControlsContext.Provider>
					</DiffReviewContext.Provider>
				</AskAboutSelection>
			)}
		</>
	);
}
