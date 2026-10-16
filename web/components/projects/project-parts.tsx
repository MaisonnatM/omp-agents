/** Pieces the Projects page and the coordinator's sidebar share: worker phase labels, the form fields' look, and the project's notes list. */
import { FileText } from "lucide-react";
import type { Project, ProjectNote, WorkerPhase } from "../../../src/shared/projects";
import { useRead } from "../../reads";
import { Age } from "../age";
import { useDashboardActions } from "../dashboard-context";

/** The look of the Projects page's text and number fields. */
export const FIELD = "rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** What the Projects page and the coordinator's sidebar call a worker's phase. */
export const PHASE_LABEL: Record<WorkerPhase, string> = { working: "Working", asking: "Asks you", idle: "Idle", interrupted: "Interrupted", ended: "Ended" };

/** The project's notes files, each opening in the file dialog, then their directory; read again whenever the project changes. */
export function ProjectNotesList({ project }: { project: Project }) {
	const { openFile } = useDashboardActions();
	const notes = useRead<{ dir: string; notes: ProjectNote[] }>(`/api/project-notes?id=${encodeURIComponent(project.id)}`, project);
	if (notes.error !== null && notes.data === null)
		return (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				{notes.error}
			</p>
		);
	if (notes.data === null) return <p className="text-sm text-muted-foreground">Reading the notes…</p>;
	return (
		<>
			{notes.data.notes.length === 0 ? (
				<p className="text-sm text-muted-foreground">No notes yet. The coordinator and its workers write them as they go.</p>
			) : (
				<ul aria-label="Notes" className="divide-y divide-border overflow-hidden rounded-md border border-border">
					{notes.data.notes.map(note => (
						<li key={note.path}>
							<button type="button" title={note.path} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none" onClick={() => openFile(note.path)}>
								<FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{note.name}</span>
								<Age at={Date.parse(note.modifiedAt)} exact className="shrink-0 text-xs tabular-nums text-muted-foreground" />
							</button>
						</li>
					))}
				</ul>
			)}
			<p className="font-mono text-xs break-all text-muted-foreground">{notes.data.dir}</p>
		</>
	);
}
