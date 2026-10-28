/** The Settings Files section: omp's config files by group, each viewed and edited in place (`Files`). */
import { Search } from "lucide-react";
import { useState } from "react";
import type { FileEdit, OmpFile, OmpSettings } from "../../../src/shared/models";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { putJson, settingsUrl } from "../../api";
import { FILE_KIND_LABELS, fileGroups, fileName, formatBytes } from "../../labels";
import { EditBar, type Editing, SaveError, useEditor } from "./editor";

/** One omp file, viewed or edited in place; also the right pane of Settings › Workflows. */
export function FileView({ file, editing }: { file: OmpFile; editing: Editing }) {
	const { body } = file;
	const editor = useEditor(
		body.state === "read" ? body.text : "",
		text =>
			putJson<OmpSettings>(settingsUrl("/file", editing.cwd), { path: file.path, text, baseHash: body.state === "read" ? body.hash : null } satisfies FileEdit),
		editing,
	);
	const viewing = editor.state.phase === "viewing";
	const conflict = editor.state.phase === "editing" && editor.state.conflict;
	return (
		<div className="flex min-w-0 flex-col gap-2 self-start md:sticky md:top-6" role="region" aria-label={file.pathDisplay}>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
					<span className="font-mono text-foreground">{file.pathDisplay}</span>
					{body.state === "read" && (
						<>
							<span className="tabular-nums">{formatBytes(body.size)}</span>
							<span>Changed {new Date(body.modifiedAt).toLocaleString()}</span>
						</>
					)}
				</p>
				{body.state !== "unreadable" && <EditBar editor={editor} label={file.pathDisplay} start={body.state === "missing" ? "Create" : "Edit"} />}
			</div>
			{!viewing ? (
				<>
					<textarea
						aria-label={`Contents of ${file.pathDisplay}`}
						spellCheck={false}
						autoFocus
						readOnly={editor.state.phase === "saving"}
						value={editor.draft}
						onChange={event => editor.change(event.target.value)}
						onKeyDown={event => {
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
									editing.reload();
								}}
							>
								Discard my edits and load the file from disk
							</Button>
						)}
					</div>
				</>
			) : body.state === "read" ? (
				<pre
					tabIndex={0}
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
			)}
		</div>
	);
}

/** omp's files by group, a filter that narrows them by name, and the one picked, the first by default, viewed in place. */
export function Files({ files, editing }: { files: OmpFile[]; editing: Editing }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const open = files.find(file => file.path === selected) ?? fileGroups(files, "")[0]?.[1][0];
	if (!open) return <p className="text-sm text-muted-foreground">omp found no files.</p>;
	const groups = fileGroups(files, query);
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav aria-label="omp files" className="space-y-4">
				<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring [&>svg]:size-3.5">
					<Search aria-hidden />
					<input
						type="search"
						aria-label="Filter omp files"
						placeholder="Filter"
						value={query}
						onChange={event => setQuery(event.target.value)}
						onKeyDown={event => {
							if (event.key !== "Escape") return;
							setQuery("");
							event.currentTarget.blur();
						}}
						className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
					/>
				</label>
				{groups.length === 0 && <p className="px-2 text-sm text-muted-foreground">No file matches.</p>}
				{groups.map(([kind, group]) => (
					<div key={kind} className="space-y-1">
						<h4 className="px-2 text-xs font-medium text-muted-foreground">{FILE_KIND_LABELS[kind]}</h4>
						<ul>
							{group.map(file => {
								const name = fileName(file);
								return (
									<li key={file.path}>
										<Tooltip content={file.pathDisplay}>
											<button
												type="button"
												aria-current={file === open ? "true" : undefined}
												onClick={() => setSelected(file.path)}
												className={cn(
													"flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
													file === open && "bg-muted font-medium",
												)}
											>
												<span className={cn("truncate", file.body.state !== "read" && "text-muted-foreground")}>{name}</span>
												<span className="ml-auto shrink-0 text-xs text-muted-foreground">
													{file.body.state === "missing" ? "missing" : file.scope === "project" ? "project" : ""}
												</span>
											</button>
										</Tooltip>
									</li>
								);
							})}
						</ul>
					</div>
				))}
			</nav>
			<FileView key={open.path} file={open} editing={editing} />
		</div>
	);
}
