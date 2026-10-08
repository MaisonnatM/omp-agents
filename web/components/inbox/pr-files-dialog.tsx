import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import type { PullRequest, PullRequestChanges } from "../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useRead } from "../../reads";
import { hashForPullRequestFiles } from "../../routing";
import { ChangesExplorer } from "../changes/changes-explorer";
import { LoadNote } from "../sheet-details";

/** `pr`'s changed files over the page, as its Code tab shows them, opened at `path`; another file opens in place. */
export function PullRequestFilesDialog({ pr, title, path, version, onClose }: { pr: PullRequest; title: string; path: string; version?: unknown; onClose: () => void }) {
	const [open, setOpen] = useState(path);
	const query = new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) });
	const list = useRead<PullRequestChanges>(`/api/pull-request/files?${query}`, version);
	return (
		<DialogPrimitive.Root open onOpenChange={next => !next && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed top-1/2 left-1/2 z-50 flex h-[calc(100vh-4rem)] w-[min(96rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden"
				>
					<div className="flex items-center gap-4 border-b border-border py-2 pr-2 pl-4">
						<DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-semibold">
							<span className="text-muted-foreground tabular-nums">#{pr.number}</span> {title}
						</DialogPrimitive.Title>
						<Tooltip content="Close" shortcut={["Esc"]}>
							<DialogPrimitive.Close asChild>
								<Button variant="ghost" size="icon-compact" aria-label="Close">
									<X />
								</Button>
							</DialogPrimitive.Close>
						</Tooltip>
					</div>
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
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
