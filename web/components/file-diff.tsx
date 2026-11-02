import { type CSSProperties, Fragment, type ReactNode, useMemo } from "react";
import type { DiffRow } from "../../src/shared/changes";
import { highlightRows, type Token, useGrammars } from "../code-highlight";
import { Code } from "./changes/code-view";
import { cn } from "@/lib/utils";

const ROW_TONE = { "+": "bg-diff-addition/8", "-": "bg-diff-deletion/8", " ": "" } as const;
const SIGN_TONE = { "+": "text-diff-addition-foreground", "-": "text-diff-deletion-foreground", " ": "" } as const;
const MARK_TONE = { "+": "bg-diff-addition", "-": "diff-mark-removed", " ": "" } as const;
const SPOKEN = { "+": "Added: ", "-": "Removed: ", " ": "" } as const;
const NUMBER = "min-w-[var(--gutter-width)] text-right";

/** One row: its mark, line numbers unless `numbered` is off, and sign held in place while its code scrolls sideways under them. */
function Row({ row, tokens, numbered }: { row: DiffRow; tokens: readonly Token[]; numbered: boolean }) {
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
				{tokens.length > 0 ? <Code tokens={tokens} /> : " "}
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

/** The caption and highlighted hunks of one file's diff, with gaps for omitted context; `numbered` off hides the line numbers. */
export function FileDiff({ path, hunks, caption, numbered = true }: { path: string; hunks: readonly (readonly DiffRow[])[]; caption: ReactNode; numbered?: boolean }) {
	const grammars = useGrammars();
	const { highlighted, width } = useMemo(() => {
		const widest = Math.max(0, ...hunks.flat().map(row => Math.max(row.old ?? 0, row.new ?? 0)));
		return { highlighted: hunks.map(hunk => ({ rows: hunk, tokens: highlightRows(hunk, path) })), width: `${String(widest).length}ch` };
	}, [hunks, path, grammars]);

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
									<Row key={i} row={row} tokens={hunk.tokens[i] ?? []} numbered={numbered} />
								))}
							</Fragment>
						))}
					</div>
				</div>
			)}
		</figure>
	);
}
