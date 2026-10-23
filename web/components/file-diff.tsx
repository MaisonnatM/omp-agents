import { type CSSProperties, Fragment, type ReactNode, useMemo } from "react";
import type { DiffRow } from "../../src/shared/changes";
import { editHunks } from "../../src/shared/transcript";
import { highlightRows, type Token } from "../code-highlight";
import { Code } from "./changes/code-view";
import { cn } from "@/lib/utils";

const ROW_TONE = { "+": "bg-diff-addition/8", "-": "bg-diff-deletion/8", " ": "" } as const;
const SIGN_TONE = { "+": "text-diff-addition-foreground", "-": "text-diff-deletion-foreground", " ": "" } as const;
const MARK_TONE = { "+": "bg-diff-addition", "-": "diff-mark-removed", " ": "" } as const;
const SPOKEN = { "+": "Added: ", "-": "Removed: ", " ": "" } as const;
const NUMBER = "min-w-[var(--gutter-width)] text-right";

/** One row: its mark, line numbers and sign held in place while its code scrolls sideways under them. */
function Row({ row, tokens }: { row: DiffRow; tokens: readonly Token[] }) {
	return (
		<div className={cn("flex", ROW_TONE[row.sign])}>
			<span aria-hidden className="sticky left-0 flex shrink-0 bg-card text-muted-foreground/70 select-none">
				<span className={cn("ml-0.5 w-1 shrink-0", MARK_TONE[row.sign])} />
				<span className={cn("flex", ROW_TONE[row.sign])}>
					<span className="flex gap-2 border-r pr-2 pl-2.5">
						<span className={NUMBER}>{row.old}</span>
						<span className={NUMBER}>{row.new}</span>
					</span>
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

/** The edit's caption and highlighted hunks, with gaps for omitted context. */
export function FileDiff({ path, diff, caption }: { path: string; diff: string; caption: ReactNode }) {
	const { hunks, width } = useMemo(() => {
		const hunks = editHunks(diff);
		const widest = Math.max(0, ...hunks.flat().map(row => Math.max(row.old ?? 0, row.new ?? 0)));
		return { hunks: hunks.map(hunk => ({ rows: hunk, tokens: highlightRows(hunk, path) })), width: `${String(widest).length}ch` };
	}, [diff, path]);

	return (
		<figure className="overflow-hidden rounded-xl border bg-card text-card-foreground">
			<figcaption className="flex h-10 items-center gap-2 border-b px-3 text-xs">{caption}</figcaption>
			{hunks.length > 0 && (
				<div dir="ltr" className="code-lines overflow-x-auto font-mono text-[13px] leading-6" style={{ "--gutter-width": width } as CSSProperties}>
					<div className="w-max min-w-full py-2">
						{hunks.map((hunk, h) => (
							<Fragment key={h}>
								{h > 0 && <GapRow />}
								{hunk.rows.map((row, i) => (
									<Row key={i} row={row} tokens={hunk.tokens[i] ?? []} />
								))}
							</Fragment>
						))}
					</div>
				</div>
			)}
		</figure>
	);
}
