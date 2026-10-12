import { type CSSProperties, useState } from "react";
import type { FileEdit, OmpFile, OmpSettings } from "../../../src/shared/models";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { putJson, settingsUrl } from "../../api";
import { FILE_KIND_LABELS, fileGroups, formatBytes } from "../../labels";
import { useStoredState } from "../../stored-state";
import { Separator, useDragSeparator } from "../drag-separator";
import { EditBar, type Editing, SaveError, useEditor } from "./editor";

const DEFAULT_NAV = 240;
const MIN_NAV = 160;
const MAX_NAV = 480;
const NAV_STEP = 16;

const clampNav = (width: number): number => Math.round(Math.max(MIN_NAV, Math.min(MAX_NAV, width)));

function FileView({ file, editing }: { file: OmpFile; editing: Editing }) {
	const { body } = file;
	const editor = useEditor(
		body.state === "read" ? body.text : "",
		text =>
			putJson<OmpSettings>(settingsUrl("/file", editing.cwd), { path: file.path, text, baseHash: body.state === "read" ? body.hash : null } satisfies FileEdit),
		editing.saved,
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

export function Files({ files, editing }: { files: OmpFile[]; editing: Editing }) {
	const groups = fileGroups(files);
	const [selected, setSelected] = useState<string | null>(null);
	const open = files.find(file => file.path === selected) ?? groups[0]?.[1][0];
	const [navWidth, setNavWidth] = useStoredState("omp-agents.settings-files-width", raw => {
		const stored = Number(raw);
		return stored >= MIN_NAV && stored <= MAX_NAV ? stored : DEFAULT_NAV;
	});
	const events = useDragSeparator({
		value: navWidth,
		onValue: setNavWidth,
		axis: "vertical",
		keyStep: NAV_STEP,
		shiftSteps: 4,
		min: MIN_NAV,
		max: MAX_NAV,
		reset: DEFAULT_NAV,
		clamp: clampNav,
		read: (event, start) => clampNav(start.value + event.clientX - start.coordinate),
	});
	if (!open) return <p className="text-sm text-muted-foreground">omp found no files.</p>;
	return (
		<div style={{ "--files-nav": `${navWidth}px` } as CSSProperties} className="relative grid gap-6 md:grid-cols-[var(--files-nav)_minmax(0,1fr)]">
			<Separator
				{...events}
				axis="vertical"
				label="Resize the file list"
				min={MIN_NAV}
				max={MAX_NAV}
				now={navWidth}
				// Centered in the 1.5rem gap between the list and the file.
				style={{ left: "calc(var(--files-nav) + 0.75rem)" }}
				className="inset-y-0 hidden w-3 -translate-x-1/2 cursor-col-resize select-none md:flex"
			/>
			<nav aria-label="omp files" className="min-w-0 space-y-4">
				{groups.map(([kind, group]) => (
					<div key={kind} className="space-y-1">
						<h4 className="px-2 text-xs font-medium text-muted-foreground">{FILE_KIND_LABELS[kind]}</h4>
						<ul>
							{group.map(file => {
								const parts = file.path.split("/");
								// A skill's file is always SKILL.md; its directory names it.
								const name = parts.at(-1) === "SKILL.md" ? parts.at(-2) : parts.at(-1);
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
