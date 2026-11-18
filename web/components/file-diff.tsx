import { type CSSProperties, Fragment, type ReactNode, useMemo } from "react";
import type { DiffRow } from "../../src/shared/changes";
import { highlightRows, type Token, useGrammars } from "../code-highlight";
import { Code } from "./changes/code-view";
import { diffWords } from "@/components/ui/inline-diff";
import { cn } from "@/lib/utils";

const ROW_TONE = { "+": "bg-diff-addition/8", "-": "bg-diff-deletion/8", " ": "" } as const;
const SIGN_TONE = { "+": "text-diff-addition-foreground", "-": "text-diff-deletion-foreground", " ": "" } as const;
const MARK_TONE = { "+": "bg-diff-addition", "-": "diff-mark-removed", " ": "" } as const;
const SPOKEN = { "+": "Added: ", "-": "Removed: ", " ": "" } as const;
const NUMBER = "min-w-[var(--gutter-width)] text-right";
/** A line longer than this gets no word marks, since the word diff's cost grows with the product of both lines' words. */
const LONGEST_MARKED = 500;

/** A run of a line's characters, from `[0]` up to but not including `[1]`. */
type Range = readonly [number, number];

const nonSpace = (text: string): number => text.replace(/\s/g, "").length;

/**
 * The words a removed line and the added line that replaces it change, as affectUI's inline diff marks them: the
 * removed line's ranges, then the added line's; `null` when the lines share less than a third of their text, which
 * reads as a rewrite rather than an edit.
 */
function changedWords(before: string, after: string): [Range[], Range[]] | null {
	if (before.length > LONGEST_MARKED || after.length > LONGEST_MARKED) return null;
	const removed: Range[] = [];
	const added: Range[] = [];
	let a = 0;
	let b = 0;
	let shared = 0;
	for (const segment of diffWords(before, after)) {
		if (segment.type === "equal") {
			a += segment.text.length;
			b += segment.text.length;
			shared += nonSpace(segment.text);
			continue;
		}
		if (segment.remove) removed.push([a, (a += segment.remove.length)]);
		if (segment.insert) added.push([b, (b += segment.insert.length)]);
	}
	return shared * 3 >= Math.max(nonSpace(before), nonSpace(after)) ? [removed, added] : null;
}

/** Each row's word marks: a run of removed rows and the run of added rows right after it pair up in order, as GitHub pairs them. */
function hunkMarks(rows: readonly DiffRow[]): (Range[] | undefined)[] {
	const marks: (Range[] | undefined)[] = [];
	let i = 0;
	while (i < rows.length) {
		if (rows[i]!.sign !== "-") {
			i++;
			continue;
		}
		let added = i;
		while (rows[added]?.sign === "-") added++;
		let end = added;
		while (rows[end]?.sign === "+") end++;
		for (let k = 0; k < Math.min(added - i, end - added); k++) {
			const words = changedWords(rows[i + k]!.text, rows[added + k]!.text);
			if (words) [marks[i + k], marks[added + k]] = words;
		}
		i = end;
	}
	return marks;
}

/** `tokens` cut at the edges of `ranges`, in runs that each lie wholly inside a range or wholly outside every one. */
function runsOf(tokens: readonly Token[], ranges: readonly Range[]): { marked: boolean; tokens: Token[] }[] {
	const runs: { marked: boolean; tokens: Token[] }[] = [];
	let at = 0;
	let r = 0;
	for (const token of tokens) {
		const start = at;
		const end = start + token.text.length;
		while (at < end) {
			while (r < ranges.length && ranges[r]![1] <= at) r++;
			const range = ranges[r];
			const marked = range !== undefined && range[0] <= at;
			const to = Math.min(end, range === undefined ? end : marked ? range[1] : range[0]);
			const piece = { className: token.className, text: token.text.slice(at - start, to - start) };
			const last = runs.at(-1);
			if (last?.marked === marked) last.tokens.push(piece);
			else runs.push({ marked, tokens: [piece] });
			at = to;
		}
	}
	return runs;
}

/** One row: its mark, line numbers unless `numbered` is off, and sign held in place while its code scrolls sideways under them; `marks` tints the words it changes against its paired row. */
function Row({ row, tokens, marks, numbered }: { row: DiffRow; tokens: readonly Token[]; marks: readonly Range[] | undefined; numbered: boolean }) {
	const Mark = row.sign === "-" ? "del" : "ins";
	return (
		<div className={cn("flex", ROW_TONE[row.sign])}>
			<span aria-hidden className="sticky left-0 flex shrink-0 bg-card text-muted-foreground/70 select-none">
				<span className={cn("ml-0.5 w-1 shrink-0", MARK_TONE[row.sign])} />
				<span className={cn("flex", ROW_TONE[row.sign])}>
					{numbered && (
						<span className="flex gap-2 border-r pr-2 pl-2.5">
							<span className={NUMBER}>{row.old}</span>
							<span className={NUMBER}>{row.new}</span>
						</span>
					)}
					<span className={cn("min-w-[1ch] px-2.5", SIGN_TONE[row.sign])}>{row.sign.trim()}</span>
				</span>
			</span>
			<span className={cn("pr-4 pl-0.5 whitespace-pre", row.sign === " " && "text-muted-foreground")}>
				{SPOKEN[row.sign] && <span className="sr-only select-none">{SPOKEN[row.sign]}</span>}
				{tokens.length === 0
					? " "
					: marks
						? runsOf(tokens, marks).map((run, index) =>
								run.marked ? (
									<Mark key={index} className={cn("rounded-[3px]", row.sign === "-" ? "bg-diff-deletion/20 line-through decoration-diff-deletion-foreground/70" : "bg-diff-addition/20 no-underline")}>
										<Code tokens={run.tokens} />
									</Mark>
								) : (
									<Fragment key={index}>
										<Code tokens={run.tokens} />
									</Fragment>
								),
							)
						: <Code tokens={tokens} />}
			</span>
		</div>
	);
}

/** The context omitted between two hunks. */
function GapRow() {
	return (
		<div aria-hidden className="flex bg-muted/60 text-muted-foreground/70 select-none">
			<span className="sticky left-0 pl-4">
				<span className={cn("block", NUMBER)}>⋯</span>
			</span>
		</div>
	);
}

/** The caption and highlighted hunks of one file's diff, with gaps for omitted context and the words each changed line changes marked; `numbered` off hides the line numbers. */
export function FileDiff({ path, hunks, caption, numbered = true }: { path: string; hunks: readonly (readonly DiffRow[])[]; caption: ReactNode; numbered?: boolean }) {
	const grammars = useGrammars();
	const { highlighted, width } = useMemo(() => {
		const widest = Math.max(0, ...hunks.flat().map(row => Math.max(row.old ?? 0, row.new ?? 0)));
		return { highlighted: hunks.map(hunk => ({ rows: hunk, tokens: highlightRows(hunk, path) })), width: `${String(widest).length}ch` };
	}, [hunks, path, grammars]);
	const marks = useMemo(() => hunks.map(hunkMarks), [hunks]);

	return (
		<figure className="overflow-hidden rounded-xl border bg-card text-card-foreground">
			<figcaption className="flex h-10 items-center gap-2 border-b px-3 text-xs">{caption}</figcaption>
			{highlighted.length > 0 && (
				<div dir="ltr" className="code-lines overflow-x-auto font-mono text-[13px] leading-6" style={{ "--gutter-width": width } as CSSProperties}>
					<div className="w-max min-w-full py-2">
						{highlighted.map((hunk, h) => (
							<Fragment key={h}>
								{h > 0 && <GapRow />}
								{hunk.rows.map((row, i) => (
									<Row key={i} row={row} tokens={hunk.tokens[i] ?? []} marks={marks[h]![i]} numbered={numbered} />
								))}
							</Fragment>
						))}
					</div>
				</div>
			)}
		</figure>
	);
}
