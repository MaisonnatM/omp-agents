import { ChevronsUpDown } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import type { ChangedFileText, DiffRow } from "../../../src/shared/changes";
import { type FileLine, fileLines, foldDiff } from "../../changes-model";
import { highlightRows, type Token } from "../../code-highlight";
import { cn } from "@/lib/utils";

const ROW_TONE = { "+": "bg-emerald-500/12", "-": "bg-red-500/12", " ": "" } as const;
const NUMBER_TONE = { "+": "bg-emerald-500/20", "-": "bg-red-500/20", " ": "" } as const;
const MARK_TONE = { added: "bg-emerald-500", modified: "bg-sky-500" } as const;
const NUMBER = "w-12 shrink-0 select-none pr-3 text-right text-muted-foreground/70";

function Code({ tokens }: { tokens: readonly Token[] }) {
	return tokens.map((token, index) => (
		<span key={index} className={token.className || undefined}>
			{token.text}
		</span>
	));
}

interface CodeViewProps {
	mode: "diff" | "file";
	/** `null` while it is read. */
	file: ChangedFileText | null;
	error: string | null;
}

/** The open file: its diff with unchanged runs folded, or the whole file with its changes marked in the gutter. */
export function CodeView({ mode, file, error }: CodeViewProps) {
	// Keyed on the rows' text, so a read that brings the same text again keeps its colors instead of highlighting anew.
	const text = file?.rows?.map(row => `${row.sign}${row.text}`).join("\n") ?? null;
	const path = file?.path ?? "";
	const rows = file?.rows;
	const tokens = useMemo(() => (rows ? highlightRows(rows, path) : []), [text, path]);
	const notice = error ?? (!file ? "Reading…" : !file.rows ? file.note : file.rows.length === 0 ? "No difference from the base." : null);
	return (
		<div className="code-lines flex min-h-0 flex-1 font-mono text-xs leading-5">
			{notice !== null || !file?.rows ? (
				<p className={cn("m-auto p-8 text-center font-sans text-sm", error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{notice}</p>
			) : mode === "diff" ? (
				<div className="min-w-0 flex-1 overflow-auto">
					<DiffLines rows={file.rows} tokens={tokens} />
				</div>
			) : (
				<FileLines rows={file.rows} tokens={tokens} />
			)}
		</div>
	);
}

/** Each row with both line numbers and its sign; a click on a fold shows the unchanged rows it hides. */
function DiffLines({ rows, tokens }: { rows: readonly DiffRow[]; tokens: readonly Token[][] }) {
	const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
	const items = useMemo(() => foldDiff(rows, opened), [rows, opened]);
	return (
		<div className="w-max min-w-full py-1">
			{items.map(item => {
				if (item.kind === "fold") {
					const count = item.to - item.from;
					return (
						<button
							key={`fold-${item.start}`}
							type="button"
							onClick={() => setOpened(prev => new Set(prev).add(item.start))}
							className="sticky left-0 flex w-full items-center gap-2 bg-sky-500/8 px-3 py-0.5 text-left font-sans text-[11px] text-sky-700 hover:bg-sky-500/15 dark:text-sky-300"
						>
							<ChevronsUpDown aria-hidden className="size-3" />
							Show {count} unchanged {count === 1 ? "line" : "lines"}
						</button>
					);
				}
				const row = rows[item.index]!;
				return (
					<div key={item.index} className={cn("flex", ROW_TONE[row.sign])}>
						<span className={cn(NUMBER, NUMBER_TONE[row.sign])}>{row.old}</span>
						<span className={cn(NUMBER, NUMBER_TONE[row.sign])}>{row.new}</span>
						<span aria-hidden className="w-5 shrink-0 select-none text-center text-muted-foreground">
							{row.sign === " " ? "" : row.sign}
						</span>
						<span className="whitespace-pre pr-6">
							<Code tokens={tokens[item.index] ?? []} />
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** Removed rows shown above the line they preceded, struck through. */
function Removed({ rows, at, tokens }: { rows: readonly DiffRow[]; at: readonly number[]; tokens: readonly Token[][] }) {
	return at.map(index => (
		<div key={`removed-${index}`} className="flex bg-red-500/12">
			<span className={cn(NUMBER, "text-red-600/70 dark:text-red-400/70")}>{rows[index]!.old}</span>
			<span className="w-1 shrink-0 bg-red-500" />
			<span className="whitespace-pre pr-6 pl-3 line-through decoration-red-500/40">
				<Code tokens={tokens[index] ?? []} />
			</span>
		</div>
	));
}

/**
 * The file as it is now. A green gutter bar marks added lines, a blue one lines that replaced others, and a red notch
 * the place lines were removed from; a click anywhere on a run's mark shows the removed lines above it. The ruler on
 * the right maps every change in the file, and a click on one scrolls to it.
 */
function FileLines({ rows, tokens }: { rows: readonly DiffRow[]; tokens: readonly Token[][] }) {
	const { lines, removedAtEnd } = useMemo(() => fileLines(rows), [rows]);
	const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
	const lineRefs = useRef(new Map<number, HTMLDivElement>());
	const endRef = useRef<HTMLButtonElement>(null);
	const toggle = (index: number): void =>
		setShown(prev => {
			const next = new Set(prev);
			if (!next.delete(index)) next.add(index);
			return next;
		});
	const endShown = shown.has(-1);
	return (
		<>
			<div className="min-w-0 flex-1 overflow-auto">
				<div className="w-max min-w-full py-1">
					{lines.map(line => {
						const row = rows[line.index]!;
						const removed = line.removed.length;
						const open = shown.has(line.run);
						return (
							<Fragment key={line.index}>
								{open && line.run === line.index && <Removed rows={rows} at={line.removed} tokens={tokens} />}
								<div
									ref={element => {
										if (element) lineRefs.current.set(line.index, element);
										else lineRefs.current.delete(line.index);
									}}
									className={cn("flex", line.mark === "added" && "bg-emerald-500/6", line.mark === "modified" && "bg-sky-500/6")}
								>
									<span className={NUMBER}>{row.new}</span>
									{removed > 0 ? (
										<button
											type="button"
											aria-expanded={open}
											aria-label={`${open ? "Hide" : "Show"} ${removed} removed ${removed === 1 ? "line" : "lines"} before line ${rows[line.run]!.new}`}
											title={`${removed} removed ${removed === 1 ? "line" : "lines"}`}
											onClick={() => toggle(line.run)}
											className={cn("relative w-1 shrink-0 cursor-pointer", line.mark ? MARK_TONE[line.mark] : "")}
										>
											{!line.mark && <span className="absolute -top-1 -left-0.5 size-0 border-x-4 border-t-4 border-x-transparent border-t-red-500" />}
										</button>
									) : (
										<span className={cn("w-1 shrink-0", line.mark && MARK_TONE[line.mark])} />
									)}
									<span className="whitespace-pre pr-6 pl-3">
										<Code tokens={tokens[line.index] ?? []} />
									</span>
								</div>
							</Fragment>
						);
					})}
					{removedAtEnd.length > 0 && (
						<>
							<button
								ref={endRef}
								type="button"
								aria-expanded={endShown}
								onClick={() => toggle(-1)}
								className="flex w-full items-center gap-2 py-0.5 pl-16 text-left font-sans text-[11px] text-red-700 hover:bg-red-500/10 dark:text-red-300"
							>
								{endShown ? "Hide" : "Show"} {removedAtEnd.length} {removedAtEnd.length === 1 ? "line" : "lines"} removed at the end
							</button>
							{endShown && <Removed rows={rows} at={removedAtEnd} tokens={tokens} />}
						</>
					)}
				</div>
			</div>
			<OverviewRuler
				lines={lines}
				removedAtEnd={removedAtEnd.length > 0}
				onJump={index => (index === -1 ? endRef.current : lineRefs.current.get(index))?.scrollIntoView({ block: "center" })}
			/>
		</>
	);
}

/**
 * A strip as tall as the view with a tick per changed line, placed by its share of the file, and one at the bottom for
 * lines removed at the end; a click scrolls to the change, `-1` naming the end.
 */
function OverviewRuler({ lines, removedAtEnd, onJump }: { lines: readonly FileLine[]; removedAtEnd: boolean; onJump: (index: number) => void }) {
	const marks = lines.flatMap((line, at) => (line.mark || line.removed.length > 0 ? [{ line, at }] : []));
	if (marks.length === 0 && !removedAtEnd) return null;
	const height = `${100 / Math.max(lines.length, 1)}%`;
	return (
		<div aria-hidden className="relative w-3 shrink-0 border-l border-border bg-muted/30">
			{marks.map(({ line, at }) => (
				<button
					key={line.index}
					type="button"
					tabIndex={-1}
					onClick={() => onJump(line.index)}
					className={cn("absolute right-0.5 left-0.5 min-h-0.5", line.mark ? MARK_TONE[line.mark] : "bg-red-500")}
					style={{ top: `${(at / lines.length) * 100}%`, height }}
				/>
			))}
			{removedAtEnd && <button type="button" tabIndex={-1} onClick={() => onJump(-1)} className="absolute right-0.5 bottom-0 left-0.5 h-0.5 bg-red-500" />}
		</div>
	);
}
