/** The Settings Files section: omp's config files by group, each viewed and edited in place (`Files`). */
import { useState, type ReactNode } from "react";
import type { FileEdit, OmpFile, OmpSettings, ReadOnlyFile } from "../../../src/shared/models";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { putJson, settingsUrl } from "../../api";
import type { Editable } from "../../editable-read";
import { FILE_KIND_LABELS, fileGroups, fileName, formatBytes } from "../../labels";
import { SearchField } from "../search-field";
import { EditBar, type Editing, RAIL_BUTTON, SaveError, useEditor, writeOrReload } from "./editor";

function FileContents({ file }: { file: ReadOnlyFile }) {
	const { body } = file;
	return body.state === "read" ? (
		<pre
			tabIndex={0}
			aria-label={`Contents of ${file.pathDisplay}`}
			className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{body.text || <span className="text-muted-foreground">The file is empty.</span>}
		</pre>
	) : (
		<p
			className={cn(
				"rounded-md border border-dashed border-border px-3 py-6 text-center text-sm",
				body.state === "unreadable" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
			)}
		>
			{body.state === "missing" ? "This file does not exist yet. omp reads it from this path once you create it." : `Cannot read this file: ${body.error}`}
		</p>
	);
}

/** Where a {@link FileView} saves: `save` sends the edit, `write` sends it in turn with the section's other saves, `reload` re-reads after a conflict. */
export interface FileSaver<R> {
	save: (edit: FileEdit) => Promise<R>;
	write: Editable<R>["write"];
	reload: () => void;
}

/** Saving a file omp's settings list, through `PUT /api/settings/file`. */
export const settingsFiles = (editing: Editing): FileSaver<OmpSettings> => ({
	save: edit => putJson<OmpSettings>(settingsUrl("/file", editing.cwd), edit),
	write: editing.write,
	reload: editing.reload,
});

function FileFrame({ file, controls, children }: { file: ReadOnlyFile; controls?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-2 self-start md:sticky md:top-6" role="region" aria-label={file.pathDisplay}>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
					<span className="font-mono text-foreground">{file.pathDisplay}</span>
					{file.body.state === "read" && (
						<>
							<span className="tabular-nums">{formatBytes(file.body.size)}</span>
							<span>Changed {new Date(file.body.modifiedAt).toLocaleString()}</span>
						</>
					)}
				</p>
				{controls}
			</div>
			{children}
		</div>
	);
}

/** One file, viewed or edited in place; the right pane of Settings › Files and Workflows, and a file of omp memory. */
export function FileView<R>(
	props: { file: ReadOnlyFile; readOnly: true } | { file: Pick<OmpFile, "path" | "pathDisplay" | "body">; saver: FileSaver<R>; readOnly?: false },
) {
	return props.readOnly ? (
		<FileFrame file={props.file}>
			<FileContents file={props.file} />
		</FileFrame>
	) : (
		<EditableFileView file={props.file} saver={props.saver} />
	);
}

function EditableFileView<R>({ file, saver }: { file: Pick<OmpFile, "path" | "pathDisplay" | "body">; saver: FileSaver<R> }) {
	const { body } = file;
	const editor = useEditor(body.state === "read" ? body.text : "", text =>
		writeOrReload(saver, () => saver.save({ path: file.path, text, baseHash: body.state === "read" ? body.hash : null })),
	);
	const viewing = editor.state.phase === "viewing";
	const conflict = editor.state.phase === "editing" && editor.state.conflict;
	return (
		<FileFrame
			file={file}
			controls={body.state !== "unreadable" && <EditBar editor={editor} label={file.pathDisplay} start={body.state === "missing" ? "Create" : "Edit"} />}
		>
			{viewing ? (
				<FileContents file={file} />
			) : (
				<>
					<textarea
						aria-label={`Contents of ${file.pathDisplay}`}
						spellCheck={false}
						autoFocus
						readOnly={editor.state.phase === "saving"}
						value={editor.draft}
						onChange={(event) => editor.change(event.target.value)}
						onKeyDown={(event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === "s") {
								event.preventDefault();
								if (editor.dirty) void editor.submit();
							}
						}}
						className="h-[70vh] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<SaveError editor={editor} />
						{conflict && (
							<Button
								variant="secondary"
								size="compact"
								onClick={() => {
									editor.cancel();
									saver.reload();
								}}
							>
								Discard my edits and load the file from disk
							</Button>
						)}
					</div>
				</>
			)}
		</FileFrame>
	);
}

/** A rail of files by group, narrowed by a filter, with the open one marked; Settings › Files and a file store of omp memory. */
export function FileRail<F extends Pick<OmpFile, "path" | "pathDisplay">>({
	label,
	filtered,
	groupsOf,
	open,
	onSelect,
	children,
}: {
	/** What the rail lists, which names it and its filter. */
	label: string;
	/** Whether the rail shows its filter. */
	filtered: boolean;
	/** The files a filter leaves, by group heading. */
	groupsOf: (query: string) => [string, F[]][];
	open: F;
	onSelect: (path: string) => void;
	/** A file's entry in the rail. */
	children: (file: F) => ReactNode;
}) {
	const [query, setQuery] = useState("");
	const groups = groupsOf(query);
	return (
		<nav aria-label={label} className="space-y-4">
			{filtered && <SearchField label={`Filter ${label}`} placeholder="Filter" query={query} onQuery={setQuery} className="min-w-0 flex-1" />}
			{groups.length === 0 && <p className="px-2 text-sm text-muted-foreground">No file matches.</p>}
			{groups.map(([heading, group]) => (
				<div key={heading} className="space-y-1">
					<h4 className="flex items-baseline gap-2 px-2 text-xs font-medium text-muted-foreground">
						{heading}
						{group.length > 1 && <span className="tabular-nums">{group.length}</span>}
					</h4>
					<ul>
						{group.map(file => (
							<li key={file.path}>
								<Tooltip content={file.pathDisplay}>
									<button
										type="button"
										aria-current={file === open ? "true" : undefined}
										onClick={() => onSelect(file.path)}
										className={cn(RAIL_BUTTON, file === open && "bg-muted font-medium")}
									>
										{children(file)}
									</button>
								</Tooltip>
							</li>
						))}
					</ul>
				</div>
			))}
		</nav>
	);
}

/**
 * Authored files only: package-owned files are previewed through their owning library.
 * The page holds `selected`, so another section can open a file here.
 */
export function Files({ files: allFiles, editing, selected, onSelect }: { files: OmpFile[]; editing: Editing; selected: string | null; onSelect: (path: string) => void }) {
	const files = allFiles.filter(file => !file.packaged);
	const all = fileGroups(files, "");
	const open = files.find((file) => file.path === selected) ?? all[0]?.[1][0];
	if (!open) return <p className="text-sm text-muted-foreground">omp found no files.</p>;
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<FileRail
				label="omp files"
				filtered
				groupsOf={query => fileGroups(files, query).map(([kind, group]) => [FILE_KIND_LABELS[kind], group])}
				open={open}
				onSelect={onSelect}
			>
				{file => (
					<>
						<span className={cn("truncate", file.body.state !== "read" && "text-muted-foreground")}>{fileName(file)}</span>
						<span className="ml-auto shrink-0 text-xs text-muted-foreground">{file.body.state === "missing" ? "missing" : file.scope === "project" ? "project" : ""}</span>
					</>
				)}
			</FileRail>
			<FileView key={open.path} file={open} saver={settingsFiles(editing)} />
		</div>
	);
}
