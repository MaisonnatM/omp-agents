/** The Settings Files section: omp's config files as folders, each viewed and edited in place (`Files`). */
import { useId, useMemo, useState, type ReactNode } from "react";
import { everyWord } from "../../../src/shared/every-word";
import type { FileEdit, OmpFile, OmpSettings, ReadOnlyFile } from "../../../src/shared/models";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { putJson, settingsUrl } from "../../api";
import { fileTree, foldersAbove } from "../../changes-model";
import { descriptionOf } from "../../frontmatter";
import type { Editable } from "../../editable-read";
import { formatBytes } from "../../labels";
import { CodeText, isMarkdownPath, MarkdownDocument } from "../file-text";
import { FolderRows, indentOf } from "../folder-rows";
import { SearchField } from "../search-field";
import { EditBar, type Editing, SaveError, useEditor, writeOrReload } from "./editor";

/** Where the file's relative links resolve: its directory. */
const dirOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

function FileContents({ file, source }: { file: ReadOnlyFile; source: boolean }) {
	const { body } = file;
	if (body.state === "read" && body.text !== "") {
		return isMarkdownPath(file.pathDisplay) && !source ? (
			<div
				tabIndex={0}
				aria-label={`Contents of ${file.pathDisplay}`}
				className="max-h-[70vh] overflow-auto rounded-lg border border-input px-6 py-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
			>
				<MarkdownDocument text={body.text} dir={dirOf(file.pathDisplay)} className="max-w-prose" />
			</div>
		) : (
			<CodeText text={body.text} path={file.pathDisplay} className="max-h-[70vh]" />
		);
	}
	return (
		<p
			className={cn(
				"rounded-md border border-dashed border-border px-3 py-6 text-center text-sm",
				body.state === "unreadable" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
			)}
		>
			{body.state === "read"
				? "The file is empty."
				: body.state === "missing"
					? "This file does not exist yet. omp reads it from this path once you create it."
					: `Cannot read this file: ${body.error}`}
		</p>
	);
}

/** Whether a Markdown file shows its source rather than rendered, and the Preview and Source buttons that switch it; other files show only their source. */
function useSourceView(file: ReadOnlyFile): { source: boolean; toggle: ReactNode } {
	const [source, setSource] = useState(false);
	if (file.body.state !== "read" || file.body.text === "" || !isMarkdownPath(file.pathDisplay)) return { source: false, toggle: null };
	return {
		source,
		toggle: (
			<div role="group" aria-label="Show the file as" className="flex items-center gap-0.5">
				{[false, true].map(option => (
					<Button key={String(option)} variant="ghost" size="xs" active={source === option} aria-pressed={source === option} onClick={() => setSource(option)}>
						{option ? "Source" : "Preview"}
					</Button>
				))}
			</div>
		),
	};
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
				<div className="flex shrink-0 items-center gap-2">{controls}</div>
			</div>
			{children}
		</div>
	);
}

/** One file, viewed or edited in place; the right pane of Settings › Files and Workflows, and a file of omp memory. */
export function FileView<R>(
	props: { file: ReadOnlyFile; readOnly: true } | { file: Pick<OmpFile, "path" | "pathDisplay" | "body">; saver: FileSaver<R>; readOnly?: false },
) {
	return props.readOnly ? <ReadOnlyFileView file={props.file} /> : <EditableFileView file={props.file} saver={props.saver} />;
}

function ReadOnlyFileView({ file }: { file: ReadOnlyFile }) {
	const view = useSourceView(file);
	return (
		<FileFrame file={file} controls={view.toggle}>
			<FileContents file={file} source={view.source} />
		</FileFrame>
	);
}

function EditableFileView<R>({ file, saver }: { file: Pick<OmpFile, "path" | "pathDisplay" | "body">; saver: FileSaver<R> }) {
	const { body } = file;
	const editor = useEditor(body.state === "read" ? body.text : "", text =>
		writeOrReload(saver, () => saver.save({ path: file.path, text, baseHash: body.state === "read" ? body.hash : null })),
	);
	const viewing = editor.state.phase === "viewing";
	const view = useSourceView(file);
	const conflict = editor.state.phase === "editing" && editor.state.conflict;
	return (
		<FileFrame
			file={file}
			controls={
				<>
					{viewing && view.toggle}
					{body.state !== "unreadable" && <EditBar editor={editor} label={file.pathDisplay} start={body.state === "missing" ? "Create" : "Edit"} />}
				</>
			}
		>
			{viewing ? (
				<FileContents file={file} source={view.source} />
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

/** A file's place in a {@link FileRail}: a skill's file is always SKILL.md, so its directory names it. */
const railPath = (path: string): string => path.replace(/\/SKILL\.md$/, "");

/**
 * A rail of files as folders, narrowed by a filter on their names, with the open one marked; Settings › Files and a file store of omp memory.
 * The folder that holds every file, such as `~`, is left out, so the rail starts at its children.
 * Folders start closed except those above the open file, which open again when another file opens; a filter opens every folder.
 */
export function FileRail<F extends Pick<OmpFile, "path" | "pathDisplay">>({
	label,
	filtered,
	files,
	pathOf,
	describe,
	open,
	onSelect,
	children,
}: {
	/** What the rail lists, which names it and its filter. */
	label: string;
	/** Whether the rail shows its filter. */
	filtered: boolean;
	files: F[];
	/** Where a file sits in the rail, its folders joined by `/`. */
	pathOf: (file: F) => string;
	/** A line under a file's name, which describes its entry rather than naming it. */
	describe?: (file: F) => string | null;
	open: F;
	onSelect: (path: string) => void;
	/** A file's entry in the rail, given the name the rail lists it by. */
	children: (file: F, name: string) => ReactNode;
}) {
	const [query, setQuery] = useState("");
	const placed = files.map(file => ({ path: railPath(pathOf(file)), file }));
	const top = fileTree(placed);
	const root = top.files.length === 0 && top.dirs.length === 1 ? `${top.dirs[0]!.path}/` : "";
	const placeOf = (path: string): string => (path.startsWith(root) ? path.slice(root.length) : path);
	const entries = placed.map(({ path, file }) => {
		const place = placeOf(path);
		return { path: place, name: place.slice(place.lastIndexOf("/") + 1), file };
	});
	const all = fileTree(entries);
	const openPath = placeOf(railPath(pathOf(open)));
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(foldersAbove(all, openPath)));
	const [revealed, setRevealed] = useState(openPath);
	if (revealed !== openPath) {
		setRevealed(openPath);
		setExpanded(new Set([...expanded, ...(foldersAbove(all, openPath) ?? [])]));
	}
	const descriptionId = useId();
	const matches = everyWord(query);
	const tree = query ? fileTree(entries.filter(entry => matches(entry.name))) : all;
	const toggle = (path: string): void =>
		setExpanded(prev => {
			const next = new Set(prev);
			if (!next.delete(path)) next.add(path);
			return next;
		});
	return (
		<nav aria-label={label} className="space-y-2">
			{filtered && <SearchField label={`Filter ${label}`} placeholder="Filter" query={query} onQuery={setQuery} className="min-w-0 flex-1" />}
			{tree.dirs.length + tree.files.length === 0 ? (
				<p className="px-2 text-sm text-muted-foreground">No file matches.</p>
			) : (
				<ul className="text-sm">
					<FolderRows
						dir={tree}
						depth={0}
						isShut={path => !query && !expanded.has(path)}
						onToggle={toggle}
						file={({ path, name, file }, depth) => {
							const description = describe?.(file);
							const id = `${descriptionId}${path}`;
							return (
								<li key={file.path}>
									<Tooltip content={file.pathDisplay}>
										<button
											type="button"
											aria-current={file === open ? "true" : undefined}
											aria-label={description ? name : undefined}
											aria-describedby={description ? id : undefined}
											onClick={() => onSelect(file.path)}
											className={cn(
												"flex w-full flex-col rounded-md py-0.5 pr-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
												file === open && "bg-muted font-medium",
											)}
											style={{ paddingLeft: indentOf(depth, true) }}
										>
											<span className="flex w-full min-w-0 items-baseline gap-2">{children(file, name)}</span>
											{description && (
												<span id={id} className="line-clamp-2 text-xs font-normal leading-snug text-muted-foreground">
													{description}
												</span>
											)}
										</button>
									</Tooltip>
								</li>
							);
						}}
					/>
				</ul>
			)}
		</nav>
	);
}

/** A skill's frontmatter `description`, which its rail entry shows under its name. */
const skillDescriptions = (files: OmpFile[]): Map<string, string | null> =>
	new Map(files.flatMap(file => (file.kind === "skill" && file.body.state === "read" ? [[file.path, descriptionOf(file.body.text)] as const] : [])));

/**
 * Authored files only: package-owned files are previewed through their owning library.
 * The page holds `selected`, so another section can open a file here; the user's context file opens first.
 */
export function Files({ files: allFiles, editing, selected, onSelect }: { files: OmpFile[]; editing: Editing; selected: string | null; onSelect: (path: string) => void }) {
	const files = allFiles.filter(file => !file.packaged);
	const descriptions = useMemo(() => skillDescriptions(allFiles), [allFiles]);
	const open = files.find(file => file.path === selected) ?? files.find(file => file.kind === "context") ?? files[0];
	if (!open) return <p className="text-sm text-muted-foreground">omp found no files.</p>;
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<FileRail
				label="omp files"
				filtered
				files={files}
				pathOf={file => file.pathDisplay}
				describe={file => descriptions.get(file.path) ?? null}
				open={open}
				onSelect={onSelect}
			>
				{(file, name) => (
					<>
						<span className={cn("truncate", file.body.state !== "read" && "text-muted-foreground")}>{name}</span>
						{file.body.state === "missing" && <span className="ml-auto shrink-0 text-xs text-muted-foreground">missing</span>}
					</>
				)}
			</FileRail>
			<FileView key={open.path} file={open} saver={settingsFiles(editing)} />
		</div>
	);
}
