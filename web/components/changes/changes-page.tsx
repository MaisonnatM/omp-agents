import { ArrowLeft, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionChanges } from "../../../src/shared/changes";
import { hashForSession, type PastSession, type RosterHost } from "../../../src/shared/sessions";
import { useChangedFiles } from "../../pane-store";
import { hostLabel, pastLabel } from "../../labels";
import { useRead } from "../../reads";
import { hashForChanges } from "../../routing";
import { Button } from "@/components/ui/button";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { LineCounts } from "../line-counts";
import { Header } from "../page-header";
import { ChangesExplorer } from "./changes-explorer";

type Scope = "all" | "session";

interface ChangesPageProps {
	sessionId: string;
	/** The file open, by the path the list gives it; `null` opens the first. */
	path: string | null;
	host: RosterHost | null;
	past: PastSession | null;
}

/**
 * The files a session changed, as an editor shows them: the explorer lists what its checkout changed against its branch
 * base and what its own edits changed, and the editor shows the open file's diff or the whole file with its changes marked.
 */
export function ChangesPage({ sessionId, path, host, past }: ChangesPageProps) {
	const [scope, setScope] = useState<Scope>("all");
	const [reads, setReads] = useState(0);
	// The session's own edits arrive as its `work`, so each one reads the changes again. A turn that starts or ends does
	// too: bash and subagents edit files without telling the page, and one that ended may have committed since the last read.
	const work = useChangedFiles(host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId });
	const edits = work?.reduce((count, file) => count + file.changes.length, 0) ?? 0;
	const version = `${reads}:${host?.status ?? "past"}:${edits}`;
	const list = useRead<SessionChanges>(`/api/changes?session=${encodeURIComponent(sessionId)}`, version);
	const files = useMemo(() => (list.data?.files ?? []).filter(file => scope === "all" || file.session), [list.data, scope]);

	const label = host ? hostLabel(host) : past ? pastLabel(past) : "Session";
	const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 });
	const changes = list.data;
	const sessionCount = changes?.files.filter(file => file.session).length ?? 0;
	const meta = changes && (
		<>
			{changes.root === null ? "Not a git checkout" : `${changes.branch ?? "detached HEAD"} against ${changes.base?.ref ?? "HEAD"}`} · {files.length} {files.length === 1 ? "file" : "files"}{" "}
			<LineCounts added={totals.added} removed={totals.removed} />
		</>
	);
	const back = (
		<Tooltip content={`Back to ${label}`} side="bottom">
			<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label={`Back to ${label}`} asChild>
				<a href={hashForSession(sessionId)}>
					<ArrowLeft />
				</a>
			</Button>
		</Tooltip>
	);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title={`Changes · ${label}`} meta={meta ?? "Reading changes…"} status={list.error ?? undefined} alert={list.error !== null} leading={back}>
				<SizeProvider size="compact">
					<Tabs value={scope} onValueChange={value => setScope(value as Scope)}>
						<TabsList aria-label="Which changes">
							<TabItem value="all" label="All changes" badge={changes?.files.length || undefined} />
							<TabItem value="session" label="This session" badge={sessionCount || undefined} tooltip="The files this session's own edit and write calls changed" />
						</TabsList>
					</Tabs>
				</SizeProvider>
				<Tooltip content="Read the changes again" side="bottom">
					<Button variant="ghost" size="icon-compact" className="text-muted-foreground" aria-label="Read the changes again" loading={list.refreshing} onClick={() => setReads(count => count + 1)}>
						<RotateCw />
					</Button>
				</Tooltip>
			</Header>
			{!changes ? (
				!list.error && <p className="m-auto text-sm text-muted-foreground">Reading changes…</p>
			) : files.length === 0 ? (
				<p className="m-auto text-sm text-muted-foreground">
					{scope === "session" ? "This session's own calls changed no file." : changes.root === null ? "The session changed no file." : "Nothing changed against the base."}
				</p>
			) : (
				<ChangesExplorer
					files={files}
					path={path}
					hrefFor={file => hashForChanges(sessionId, file)}
					fileUrl={file => `/api/changes/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(file)}`}
					version={version}
				/>
			)}
		</div>
	);
}
