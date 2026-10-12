import { RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionChanges } from "../../../src/shared/changes";
import type { ChangedFile } from "../../../src/shared/transcript";
import { changesPathOf } from "../../changes-model";
import { useRead } from "../../reads";
import { Button } from "@/components/ui/button";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider } from "@/lib/size-context";
import { LineCounts } from "../line-counts";
import { LoadNote } from "../sheet-details";
import { ChangesExplorer } from "./changes-explorer";
import { ExplorerDialog } from "./explorer-dialog";

type Scope = "all" | "session";

interface SessionChangesDialogProps {
	sessionId: string;
	/** The session's directory, which the Files tab's paths are relative to. */
	cwd: string | null;
	/** The file to open first, as the Files tab names it; `null` opens the first file. */
	path: string | null;
	/** The session's own changed files: each change reads the list again. */
	work: ChangedFile[] | null;
	/** A turn that starts or ends reads the list again, since bash and subagents change files without telling the page. */
	working: boolean;
	onClose: () => void;
}

/**
 * The files a session changed, over the page as an editor shows them: what its checkout changed against its branch base
 * and what its own calls changed; another file opens in place.
 */
export function SessionChangesDialog({ sessionId, cwd, path, work, working, onClose }: SessionChangesDialogProps) {
	const [scope, setScope] = useState<Scope>("all");
	const [reads, setReads] = useState(0);
	const [picked, setPicked] = useState<string | null>(null);
	const edits = work?.reduce((count, file) => count + file.changes.length, 0) ?? 0;
	const version = `${reads}:${working}:${edits}`;
	const list = useRead<SessionChanges>(`/api/changes?session=${encodeURIComponent(sessionId)}`, version);
	const changes = list.data;
	const files = useMemo(() => (changes?.files ?? []).filter(file => scope === "all" || file.session), [changes, scope]);
	const asked = useMemo(() => (changes && path !== null ? changesPathOf(path, cwd, changes.root, changes.files) : null), [changes, path, cwd]);

	const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 });
	const sessionCount = changes?.files.filter(file => file.session).length ?? 0;
	const title = (
		<>
			Changes
			{changes && (
				<span className="ml-2 font-normal text-muted-foreground">
					{changes.root === null ? "Not a git checkout" : `${changes.branch ?? "detached HEAD"} against ${changes.base?.ref ?? "HEAD"}`} · {files.length} {files.length === 1 ? "file" : "files"}{" "}
					<LineCounts added={totals.added} removed={totals.removed} />
				</span>
			)}
		</>
	);
	const actions = (
		<>
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
		</>
	);
	return (
		<ExplorerDialog title={title} actions={actions} onClose={onClose}>
			{!changes ? (
				<div className="px-4 py-3">
					<LoadNote loading="Reading changes…" error={list.error && `Cannot load the changes: ${list.error}`} />
				</div>
			) : files.length === 0 ? (
				<p className="m-auto text-sm text-muted-foreground">
					{scope === "session" ? "This session's own calls changed no file." : changes.root === null ? "The session changed no file." : "Nothing changed against the base."}
				</p>
			) : (
				<ChangesExplorer
					files={files}
					path={picked ?? asked}
					onPick={setPicked}
					fileUrl={file => `/api/changes/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(file)}`}
					version={version}
				/>
			)}
		</ExplorerDialog>
	);
}
