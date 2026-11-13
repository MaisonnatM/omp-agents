/** The Overview tab's Files, Images, and Sources sections: the files the view's agent changed, the images its tools took, and the pages they opened, each a section that folds. */
import { useMemo, useState } from "react";
import type { SessionFacts, View } from "../../src/shared/sessions";
import { type AgentMedia, type AgentSource, type ChangedFile, lineTotals } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { activityControl } from "../activity";
import { useChangedFiles, useMedia, useSources } from "../pane-store";
import { useStoredKeys } from "../stored-state";
import { ChangedFileList, FileChangesDialog } from "./changed-files-section";
import { SessionChangesDialog } from "./changes/session-changes-dialog";
import { LineCounts } from "./line-counts";
import { MediaStrip } from "./media-section";
import { OverviewSection } from "./overview-section";
import { SourceList } from "./sources-section";

/** The sections folded shut, `files`, `images`, and `sources`, which localStorage keeps for every view; each starts open. The key keeps an earlier name, so earlier folds carry over. */
const CLOSED_KEY = "omp-agents.changes-card-closed";

/** The session whose changes the Overview tab lists. */
export interface ChangesSession {
	/** The session whose changes **Review** and a file open; `null` for a subagent, whose files open omp's recorded diffs. */
	sessionId: string | null;
	/** The session's directory, which the files' relative paths resolve against. */
	cwd: string | null;
	/** The session's pull requests and Linear issues, which selected images can be sent to and the sources leave out, and its arenas. */
	facts: Pick<SessionFacts, "pullRequests" | "tickets" | "arenas"> | null;
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

/** The view's changes for `session`, each list empty until the server sends it, and whether it sent all three. */
export function useChanges(view: View, session: ChangesSession): { changes: Changes; loaded: boolean } {
	const sentFiles = useChangedFiles(view);
	const sentMedia = useMedia(view);
	const allSources = useSources(view);
	const files = sentFiles ?? NONE;
	const media = sentMedia ?? NONE;
	const facts = session.facts;
	const sources = useMemo(() => (allSources ? otherSources(allSources, facts) : NONE), [allSources, facts]);
	const changes = useMemo(() => ({ files, media, sources }), [files, media, sources]);
	return { changes, loaded: sentFiles !== null && sentMedia !== null && allSources !== null };
}

/** What the Overview tab opens over the page: the session's changes opened at a file, or one file's recorded changes for a subagent. */
type Shown = { kind: "changes" | "history"; path: string } | null;

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
				<OverviewSection
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
				</OverviewSection>
			)}
			{media.length > 0 && (
				<OverviewSection title="Images" count={media.length} open={!closed.has("images")} onToggle={() => toggle("images")} fold="changes-card.images.fold">
					<MediaStrip media={media} view={view} pullRequests={facts?.pullRequests ?? []} tickets={facts?.tickets ?? []} />
				</OverviewSection>
			)}
			{sources.length > 0 && (
				<OverviewSection title="Sources" count={sources.length} open={!closed.has("sources")} onToggle={() => toggle("sources")} fold="changes-card.sources.fold">
					<SourceList sources={sources} />
				</OverviewSection>
			)}
			{history && <FileChangesDialog file={history} onClose={() => setShown(null)} />}
			{sessionId !== null && shown?.kind === "changes" && (
				<SessionChangesDialog sessionId={sessionId} cwd={cwd} path={shown.path} work={files} working={working} onClose={() => setShown(null)} />
			)}
		</>
	);
}
