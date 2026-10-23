/** The changes card on top of the composer: the files the view's agent changed and the images its tools took, each in a section that folds. */
import { ChevronDown } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import type { SessionFacts, View } from "../../src/shared/sessions";
import { lineTotals } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useChangedFiles, useMedia } from "../pane-store";
import { useStoredKeys } from "../stored-state";
import { ChangedFileList, FileChangesDialog } from "./changed-files-section";
import { SessionChangesDialog } from "./changes/session-changes-dialog";
import { LineCounts } from "./line-counts";
import { MediaStrip } from "./media-section";

/** The sections folded shut, `files` and `images`, which localStorage keeps for every view; each starts open. */
const CLOSED_KEY = "omp-agents.changes-card-closed";

/** What the card shows over the page: the session's changes opened at a file, or one file's recorded changes for a subagent. */
type Shown = { kind: "changes" | "history"; path: string } | null;

interface CardSectionProps {
	title: ReactNode;
	open: boolean;
	onToggle: () => void;
	/** A control at the right of the header, outside the button that folds the section. */
	action?: ReactNode;
	children: ReactNode;
}

function CardSection({ title, open, onToggle, action, children }: CardSectionProps) {
	return (
		<Collapsible open={open} onOpenChange={onToggle}>
			<div className="flex h-8 items-center gap-2 pr-1.5 pl-1">
				<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded-md px-1.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
					<ChevronDown aria-hidden className={cn("size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none", !open && "-rotate-90")} />
					{title}
				</CollapsibleTrigger>
				{action}
			</div>
			<CollapsibleContent keepMounted className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}

interface ChangesCardProps {
	view: View;
	/** The session whose changes **Review** and a file open; `null` for a subagent, whose files open omp's recorded diffs. */
	sessionId: string | null;
	/** The session's directory, which the files' relative paths resolve against. */
	cwd: string | null;
	/** A turn that starts or ends reads the session's changes again. */
	working: boolean;
	/** The session's pull requests and Linear issues, which selected images can be sent to. */
	facts: Pick<SessionFacts, "pullRequests" | "tickets"> | null;
	className?: string;
}

/**
 * The files the view's agent changed and the images its agents' tools returned or wrote, as two folding sections tucked
 * under the composer's top edge; it shows neither section while it has nothing to list. On a session, a file opens the
 * session's changes at it and **Review** at the first; on a subagent, a file opens omp's recorded diffs of it.
 */
export const ChangesCard = memo(function ChangesCard({ view, sessionId, cwd, working, facts, className }: ChangesCardProps) {
	const files = useChangedFiles(view);
	const media = useMedia(view);
	const [closed, toggle] = useStoredKeys(CLOSED_KEY);
	const [shown, setShown] = useState<Shown>(null);
	const history = shown?.kind === "history" ? files?.find(file => file.path === shown.path) : undefined;
	if (!files?.length && !media?.length) return null;
	return (
		<>
			<section aria-label="Changes" className={cn("mx-3 -mb-3 divide-y divide-border/60 rounded-t-xl bg-muted pb-3", className)}>
				{files && files.length > 0 && (
					<CardSection
						title={
							<>
								<span className="truncate">{files.length === 1 ? "1 File" : `${files.length} Files`}</span>
								<LineCounts {...lineTotals(files.flatMap(file => file.changes))} />
							</>
						}
						open={!closed.has("files")}
						onToggle={() => toggle("files")}
						action={
							sessionId !== null && (
								<Button variant="ghost" size="xs" aria-haspopup="dialog" onClick={() => setShown({ kind: "changes", path: files[0]!.path })}>
									Review
								</Button>
							)
						}
					>
						<div className="max-h-[min(40vh,15rem)] overflow-y-auto">
							<ChangedFileList files={files} onOpen={path => setShown({ kind: sessionId === null ? "history" : "changes", path })} />
						</div>
					</CardSection>
				)}
				{media && media.length > 0 && (
					<CardSection title={media.length === 1 ? "1 Image" : `${media.length} Images`} open={!closed.has("images")} onToggle={() => toggle("images")}>
						<MediaStrip media={media} view={view} pullRequests={facts?.pullRequests ?? []} tickets={facts?.tickets ?? []} />
					</CardSection>
				)}
			</section>
			{history && <FileChangesDialog file={history} onClose={() => setShown(null)} />}
			{sessionId !== null && shown?.kind === "changes" && (
				<SessionChangesDialog sessionId={sessionId} cwd={cwd} path={shown.path} work={files} working={working} onClose={() => setShown(null)} />
			)}
		</>
	);
});
