/** Pieces the Projects page and the coordinator's sidebar share: worker phase labels, the form fields' look, and the notes list: the project's Notes page notes, its notes directory, and the user's. */
import { FileText, Folder } from "lucide-react";
import { useContext } from "react";
import type { Project, ProjectNote, ProjectNotesAnswer, WorkerPhase } from "../../../src/shared/projects";
import { noteRows } from "../../notes-model";
import { PAGE_ICON } from "../../page-icons";
import { useRead } from "../../reads";
import { hashForNotes } from "../../routing";
import { Age } from "../age";
import { UserNotesContext, useDashboardActions } from "../dashboard-context";

/** The look of the Projects page's text and number fields. */
export const FIELD = "rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** What the Projects page and the coordinator's sidebar call a worker's phase. */
export const PHASE_LABEL: Record<WorkerPhase, string> = { working: "Working", asking: "Asks you", idle: "Idle", interrupted: "Interrupted", ended: "Ended" };

/** One group of the notes list: its files as a tree, each opening in the file dialog, then their directory. */
function NotesTree({ label, dir, notes, empty }: { label: string; dir: string; notes: ProjectNote[]; empty: string }) {
	const { openFile } = useDashboardActions();
	const rows = noteRows(notes);
	return (
		<section aria-label={`${label} notes`} className="space-y-1.5">
			<h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{empty}</p>
			) : (
				<ul className="overflow-hidden rounded-md border border-border py-1">
					{rows.map(row => (
						<li key={row.kind === "folder" ? `${row.path}/` : row.note.path}>
							{row.kind === "folder" ? (
								<div className="flex items-center gap-2 py-1 pr-3 text-sm text-muted-foreground" style={{ paddingLeft: 12 + row.depth * 16 }}>
									<Folder aria-hidden className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate">{row.name}</span>
								</div>
							) : (
								<button
									type="button"
									title={row.note.path}
									className="flex w-full items-center gap-2 py-1 pr-3 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
									style={{ paddingLeft: 12 + row.depth * 16 }}
									onClick={() => openFile(row.note.path)}
								>
									<FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">{row.name}</span>
									<Age at={Date.parse(row.note.modifiedAt)} exact className="shrink-0 text-xs tabular-nums text-muted-foreground" />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			<p className="font-mono text-xs break-all text-muted-foreground">{dir}</p>
		</section>
	);
}

/** The notes on the Notes page that belong to the project, each opening there in the project's list. */
function PageNotes({ project }: { project: Project }) {
	const list = useContext(UserNotesContext);
	const notes = list?.notes.filter(note => note.projectId === project.id) ?? [];
	return (
		<section aria-label="Notes page notes" className="space-y-1.5">
			<h4 className="text-xs font-medium text-muted-foreground">Notes page</h4>
			{list === null ? (
				<p className="text-sm text-muted-foreground">Loading your notes…</p>
			) : notes.length === 0 ? (
				<p className="text-sm text-muted-foreground">No note on the Notes page belongs to this project.</p>
			) : (
				<ul className="overflow-hidden rounded-md border border-border py-1">
					{notes.map(note => (
						<li key={note.id}>
							<a href={hashForNotes({ kind: "project", id: project.id }, note.id)} className="flex w-full items-center gap-2 px-3 py-1 text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
								<PAGE_ICON.notes aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
								<Age at={Date.parse(note.updatedAt)} exact className="shrink-0 text-xs tabular-nums text-muted-foreground" />
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** The project's Notes page notes, then its notes directory and the user's, each a tree of its files under its own heading; the directories are read again whenever the project changes. */
export function ProjectNotesList({ project }: { project: Project }) {
	const notes = useRead<ProjectNotesAnswer>(`/api/project-notes?id=${encodeURIComponent(project.id)}`, project);
	return (
		<div className="space-y-4">
			<PageNotes project={project} />
			{notes.error !== null && notes.data === null ? (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					{notes.error}
				</p>
			) : notes.data === null ? (
				<p className="text-sm text-muted-foreground">Reading the notes…</p>
			) : (
				<>
					<NotesTree label="Project" dir={notes.data.dir} notes={notes.data.notes} empty="No notes yet. The coordinator and its workers write them as they go." />
					<NotesTree label="User" dir={notes.data.userDir} notes={notes.data.userNotes} empty="No notes yet. Every project's sessions record here how you work." />
				</>
			)}
		</div>
	);
}
