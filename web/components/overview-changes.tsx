/** The Overview tab's Files, Images, and Sources sections: the files the view's agent changed, the images its tools took, and the pages they opened, each a section that folds. */
import { IconChevronBottom } from "central-icons";
import { type ReactNode, useMemo, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import type { SessionFacts, View } from "../../src/shared/sessions";
import { type AgentMedia, type AgentSource, type ChangedFile, lineTotals } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { useChangedFiles, useMedia, useSources } from "../pane-store";
import { useStoredKeys } from "../stored-state";
import { ChangedFileList, FileChangesDialog } from "./changed-files-section";
import { SessionChangesDialog } from "./changes/session-changes-dialog";
import { LineCounts } from "./line-counts";
import { MediaStrip } from "./media-section";
import { SourceList } from "./sources-section";

/** The sections folded shut, `files`, `images`, and `sources`, which localStorage keeps for every view; each starts open. The key keeps an earlier name, so earlier folds carry over. */
const CLOSED_KEY = "omp-agents.changes-card-closed";

/** The session whose changes the Overview tab lists. */
export interface ChangesSession {
	/** The session whose changes **Review** and a file open; `null` for a subagent, whose files open omp's recorded diffs. */
	sessionId: string | null;
	/** The session's directory, which the files' relative paths resolve against. */
	cwd: string | null;
	/** The session's pull requests and Linear issues, which selected images can be sent to and the sources leave out, its /ship run, and its arenas. */
	facts: Pick<SessionFacts, "pullRequests" | "tickets" | "ship" | "arenas"> | null;
}

/** What the view's agents changed, took, and opened, each list empty until the server sends it. */
export interface Changes {
	files: ChangedFile[];
	media: AgentMedia[];
	sources: AgentSource[];
}

/** `sources` without the session's own pull requests and Linear issues, at any of their pages, which the session details sidebar shows. */
function otherSources(sources: AgentSource[], facts: ChangesSession["facts"]): AgentSource[] {
	if (!facts || (facts.pullRequests.length === 0 && facts.tickets.length === 0)) return sources;
	const own = [
		...facts.pullRequests.map(pr => `github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`),
		...facts.tickets.map(id => `linear.app/[^/]+/issue/${id}`),
	].map(page => new RegExp(`^${page.replaceAll(".", "\\.")}(?:/|$)`, "i"));
	return sources.filter(({ url }) => {
		const { hostname, pathname } = new URL(url);
		return !own.some(page => page.test(`${hostname}${pathname}`));
	});
}

const NONE: never[] = [];

/** The view's changes for `session`, or `null` while there is nothing to list. */
export function useChanges(view: View, session: ChangesSession): Changes | null {
	const files = useChangedFiles(view) ?? NONE;
	const media = useMedia(view) ?? NONE;
	const allSources = useSources(view);
	const facts = session.facts;
	const sources = useMemo(() => (allSources ? otherSources(allSources, facts) : NONE), [allSources, facts]);
	const changes = useMemo(() => ({ files, media, sources }), [files, media, sources]);
	if (files.length === 0 && media.length === 0 && sources.length === 0) return null;
	return changes;
}

/** What the Overview tab opens over the page: the session's changes opened at a file, or one file's recorded changes for a subagent. */
type Shown = { kind: "changes" | "history"; path: string } | null;

interface ChangesSectionProps {
	title: string;
	/** How many items the section lists, after its title. */
	count: number;
	/** Shown after the count, such as the files' added and removed lines. */
	detail?: ReactNode;
	open: boolean;
	onToggle: () => void;
	/** The Activity control a click on the folding header records. */
	fold: ControlId;
	/** A control at the right of the header, outside the button that folds the section. */
	action?: ReactNode;
	children: ReactNode;
}

/** A section of the Overview tab: a filled folding header, its title then its count, with an optional action at its right. */
export function ChangesSection({ title, count, detail, open, onToggle, fold, action, children }: ChangesSectionProps) {
	return (
		<Collapsible open={open} onOpenChange={onToggle}>
			<div className="flex h-9 items-center rounded-lg bg-muted">
				<CollapsibleTrigger
					{...activityControl(fold)}
					className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 text-left text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
				>
					<span className="truncate">{title}</span>
					<span className="shrink-0 font-normal text-muted-foreground tabular-nums">{count}</span>
					{detail}
					<IconChevronBottom aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
				</CollapsibleTrigger>
				{action}
			</div>
			<CollapsibleContent keepMounted className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}

interface ChangesSectionsProps {
	view: View;
	session: ChangesSession;
	changes: Changes;
	/** A turn that starts or ends reads the session's changes again. */
	working: boolean;
}

/**
 * The Files, Images, and Sources sections of the Overview tab, each shown only while it has items. On a session, a file
 * opens the session's changes at it and **Review** at the first; on a subagent, a file opens omp's recorded diffs of it.
 */
export function ChangesSections({ view, session: { sessionId, cwd, facts }, changes: { files, media, sources }, working }: ChangesSectionsProps) {
	const [closed, toggle] = useStoredKeys(CLOSED_KEY);
	const [shown, setShown] = useState<Shown>(null);
	const history = shown?.kind === "history" ? files.find(file => file.path === shown.path) : undefined;
	return (
		<>
			{files.length > 0 && (
				<ChangesSection
					title="Files"
					count={files.length}
					detail={<LineCounts {...lineTotals(files.flatMap(file => file.changes))} />}
					open={!closed.has("files")}
					onToggle={() => toggle("files")}
					fold="changes-card.files.fold"
					action={
						sessionId !== null && (
							<Button {...activityControl("changes-card.review")} variant="ghost" size="xs" className="mr-1.5" aria-haspopup="dialog" onClick={() => setShown({ kind: "changes", path: files[0]!.path })}>
								Review
							</Button>
						)
					}
				>
					<ChangedFileList files={files} onOpen={path => setShown({ kind: sessionId === null ? "history" : "changes", path })} />
				</ChangesSection>
			)}
			{media.length > 0 && (
				<ChangesSection title="Images" count={media.length} open={!closed.has("images")} onToggle={() => toggle("images")} fold="changes-card.images.fold">
					<MediaStrip media={media} view={view} pullRequests={facts?.pullRequests ?? []} tickets={facts?.tickets ?? []} />
				</ChangesSection>
			)}
			{sources.length > 0 && (
				<ChangesSection title="Sources" count={sources.length} open={!closed.has("sources")} onToggle={() => toggle("sources")} fold="changes-card.sources.fold">
					<SourceList sources={sources} />
				</ChangesSection>
			)}
			{history && <FileChangesDialog file={history} onClose={() => setShown(null)} />}
			{sessionId !== null && shown?.kind === "changes" && (
				<SessionChangesDialog sessionId={sessionId} cwd={cwd} path={shown.path} work={files} working={working} onClose={() => setShown(null)} />
			)}
		</>
	);
}
