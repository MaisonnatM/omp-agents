import { ChevronsUpDown } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import type { ChangedFileText, DiffRow } from "../../../src/shared/changes";
import type { DiffSide } from "../../../src/shared/review-drafts";
import { type ChangeBlock, changeBlocks, type FileLine, fileLines, foldDiff } from "../../changes-model";
import { highlightRows, type Token } from "../../code-highlight";
import { useRead } from "../../reads";
import { withoutWhitespaceChanges } from "../../diff-options";
import { cn } from "@/lib/utils";
import { type LineRange, useDiffReview } from "./diff-review";

/** One code row's height in px, `leading-5`. */
export const ROW_HEIGHT = 20;

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
	/** The read of one file in full, with its diff. */
	url: string;
	/** A new version reads it again. */
	version: string | number;
}

/** The file at `url`, its rows colored, and the line that shows instead of them while it is read, when it fails, or when it has none. */
function useHighlightedRead({ url, version }: CodeViewProps, ignoreWhitespace = false): { rows: readonly DiffRow[] | null; tokens: Token[][]; notice: string | null; failed: boolean } {
	const { data: file, error } = useRead<ChangedFileText>(url, version);
	const rows = useMemo(() => (file?.rows && ignoreWhitespace ? withoutWhitespaceChanges(file.rows) : (file?.rows ?? null)), [file?.rows, ignoreWhitespace]);
	// Keyed on the rows' text, so a read that brings the same text again keeps its colors instead of highlighting anew.
	const text = rows?.map(row => `${row.sign}${row.text}`).join("\n") ?? null;
	const path = file?.path ?? "";
	const tokens = useMemo(() => (rows ? highlightRows(rows, path) : []), [text, path]);
	const notice = error ?? (!file ? "Reading…" : !file.rows ? file.note : file.rows.length === 0 ? "No difference from the base." : null);
	return { rows: notice === null ? rows : null, tokens, notice, failed: error !== null };
}

function Notice({ text, error }: { text: string | null; error: boolean }) {
	return <p className={cn("m-auto p-8 text-center font-sans text-sm", error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{text}</p>;
}

/** The file as it is now, its changes marked in the gutter, filling the editor. */
export function CodeView(props: CodeViewProps) {
	const { rows, tokens, notice, failed } = useHighlightedRead(props);
	return (
		<div className="code-lines flex min-h-0 flex-1 font-mono text-xs leading-5">
			{rows ? <FileLines rows={rows} tokens={tokens} /> : <Notice text={notice} error={failed} />}
		</div>
	);
}

/** One file's diff with unchanged runs folded, as tall as its rows, scrolling sideways on its own. */
export function DiffView({ path, ...props }: CodeViewProps & { path: string }) {
	const { options } = useDiffReview();
	const { rows, tokens, notice, failed } = useHighlightedRead(props, options.ignoreWhitespace);
	return (
		<div className="code-lines overflow-x-auto font-mono text-xs leading-5">
			{rows ? <DiffLines path={path} rows={rows} tokens={tokens} /> : <Notice text={notice} error={failed} />}
		</div>
	);
}

const lineOn = (row: DiffRow, side: DiffSide): number | null => (side === "LEFT" ? row.old : row.new);

/** What every row of one diff draws from. */
interface Lines {
	rows: readonly DiffRow[];
	tokens: readonly Token[][];
	wrap: boolean;
	range: LineRange | null;
	/** Picks a line, `extend` keeping the range's first; `null` where lines cannot be picked. */
	pick: ((line: number, side: DiffSide, extend: boolean) => void) | null;
}

/**
 * Each row with its line numbers, stacked with its sign or split with the base on the left; a click on a fold shows the
 * unchanged rows it hides. Where the page takes line comments, a click on a line number picks it, a shift-click the range
 * to it, and the page's comment slot shows under the range's last line.
 */
function DiffLines({ path, rows, tokens }: { path: string; rows: readonly DiffRow[]; tokens: readonly Token[][] }) {
	const { options, LineComment } = useDiffReview();
	const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
	const [picked, setPicked] = useState<{ side: DiffSide; anchor: number; end: number } | null>(null);
	const items = useMemo(() => foldDiff(rows, opened), [rows, opened]);
	const blocks = useMemo(() => new Map(changeBlocks(rows).map(block => [block.start, block])), [rows]);
	const range = picked && { side: picked.side, start: Math.min(picked.anchor, picked.end), end: Math.max(picked.anchor, picked.end) };
	const lines: Lines = {
		rows,
		tokens,
		wrap: options.wrap,
		range,
		pick: LineComment && ((line, side, extend) => setPicked(previous => ({ side, anchor: extend && previous?.side === side ? previous.anchor : line, end: line }))),
	};
	const slot = (indexes: readonly number[]) =>
		LineComment && range && indexes.some(index => lineOn(rows[index]!, range.side) === range.end) && <LineComment path={path} range={range} onClose={() => setPicked(null)} />;
	return (
		<div className={cn("min-w-full py-1", !options.wrap && "w-max")}>
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
				if (options.layout === "stacked") {
					return (
						<Fragment key={item.index}>
							<StackedRow lines={lines} index={item.index} />
							{slot([item.index])}
						</Fragment>
					);
				}
				// A change's rows are never folded, so the block shows with its first row and its other rows show nothing.
				const block = blocks.get(item.index);
				return (
					block && (
						<Fragment key={item.index}>
							<SplitBlock lines={lines} block={block} />
							{slot(block.kind === "same" ? [block.start] : [...block.removed, ...block.added])}
						</Fragment>
					)
				);
			})}
		</div>
	);
}

function LineNumber({ lines, line, side, sign }: { lines: Lines; line: number | null; side: DiffSide; sign: DiffRow["sign"] }) {
	const tone = cn(NUMBER, NUMBER_TONE[sign]);
	const { range, pick } = lines;
	if (line === null || !pick) return <span className={tone}>{line}</span>;
	return (
		<button
			type="button"
			aria-label={`Select ${side === "LEFT" ? "old" : "new"} line ${line}`}
			aria-pressed={range?.side === side && line >= range.start && line <= range.end}
			onClick={event => pick(line, side, event.shiftKey)}
			className={cn(tone, "hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/25")}
		>
			{line}
		</button>
	);
}

function LineCode({ lines, index }: { lines: Lines; index: number }) {
	return (
		<span className={cn("min-w-0 pr-6", lines.wrap ? "flex-1 whitespace-pre-wrap break-all" : "whitespace-pre")}>
			<Code tokens={lines.tokens[index] ?? []} />
		</span>
	);
}

/** A row with the base's line number, the head's, and its sign. */
function StackedRow({ lines, index }: { lines: Lines; index: number }) {
	const row = lines.rows[index]!;
	return (
		<div className={cn("flex", ROW_TONE[row.sign])}>
			<LineNumber lines={lines} line={row.old} side="LEFT" sign={row.sign} />
			<LineNumber lines={lines} line={row.new} side="RIGHT" sign={row.sign} />
			<span aria-hidden className="w-5 shrink-0 select-none text-center text-muted-foreground">
				{row.sign === " " ? "" : row.sign}
			</span>
			<LineCode lines={lines} index={index} />
		</div>
	);
}

/** An unchanged row on both sides, or a change's removed rows on the left beside the rows that replaced them. */
function SplitBlock({ lines, block }: { lines: Lines; block: ChangeBlock }) {
	const left = block.kind === "same" ? [block.start] : block.removed;
	const right = block.kind === "same" ? [block.start] : block.added;
	return Array.from({ length: Math.max(left.length, right.length) }, (_, at) => (
		<div key={at} className="grid grid-cols-2 divide-x divide-border">
			<SplitCell lines={lines} index={left[at] ?? null} side="LEFT" />
			<SplitCell lines={lines} index={right[at] ?? null} side="RIGHT" />
		</div>
	));
}

function SplitCell({ lines, index, side }: { lines: Lines; index: number | null; side: DiffSide }) {
	if (index === null) return <div className="flex min-w-0 flex-1" />;
	const row = lines.rows[index]!;
	return (
		<div className={cn("flex min-w-0 flex-1", ROW_TONE[row.sign])}>
			<LineNumber lines={lines} line={lineOn(row, side)} side={side} sign={row.sign} />
			<LineCode lines={lines} index={index} />
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
