import { type ReactNode, useMemo } from "react";
import type { DiffRow } from "../../src/shared/changes";
import { editHunks } from "../../src/shared/transcript";
import { highlightRows, type Token } from "../code-highlight";
import { cn } from "@/lib/utils";

const GAP = "bg-muted/60";
const ROW_TONE = { "+": "bg-success/8", "-": "bg-destructive/8", " ": "" } as const;
const SIGN_TONE = { "+": "text-success", "-": "text-destructive", " ": "" } as const;
const MARK_TONE = { "+": "bg-success", "-": "bg-[repeating-linear-gradient(45deg,var(--destructive)_0_2px,transparent_2px_4px)] opacity-80", " ": "" } as const;
const SPOKEN = { "+": "Added: ", "-": "Removed: ", " ": "" } as const;

type Line = { row: DiffRow; tokens: Token[] } | null;

function Gutter({ old, next, sign, width, className, signClassName }: { old: ReactNode; next: ReactNode; sign: ReactNode; width: string; className?: string; signClassName?: string }) {
	return (
		<div className={cn("flex", className)}>
			<span className="flex gap-2 border-r pr-2 pl-2.5">
				<span className="text-right" style={{ minWidth: width }}>
					{old}
				</span>
				<span className="text-right" style={{ minWidth: width }}>
					{next}
				</span>
			</span>
			<span className={cn("min-w-[1ch] px-2.5", signClassName)}>{sign}</span>
		</div>
	);
}

/** The edit's caption and highlighted hunks, with gaps for omitted context. */
export function FileDiff({ path, diff, caption }: { path: string; diff: string | null; caption: ReactNode }) {
	const { lines, runs, width } = useMemo(() => {
		const hunks = diff ? editHunks(diff) : [];
		const lines: Line[] = [];
		let widest = 0;
		for (const hunk of hunks) {
			const tokens = highlightRows(hunk, path);
			let index = 0;
			if (lines.length > 0) lines.push(null);
			for (const row of hunk) {
				lines.push({ row, tokens: tokens[index++]! });
				widest = Math.max(widest, row.old ?? 0, row.new ?? 0);
			}
		}
		const runs: { tone: string; count: number }[] = [];
		for (const line of lines) {
			const tone = line ? MARK_TONE[line.row.sign] : GAP;
			const last = runs.at(-1);
			if (last?.tone === tone) last.count++;
			else runs.push({ tone, count: 1 });
		}
		return { lines, runs, width: `${String(widest).length}ch` };
	}, [diff, path]);

	return (
		<figure className="overflow-hidden rounded-xl border bg-card text-card-foreground">
			<figcaption className="flex h-10 items-center gap-2 border-b px-3 text-xs">{caption}</figcaption>
			{lines.length > 0 && (
				<div dir="ltr" className="flex font-mono text-[13px] [--diff-line:1.5rem] leading-[var(--diff-line)]">
					<div aria-hidden className="w-1.5 shrink-0 py-2">
						{runs.map((run, index) => (
							<div key={index} className={cn("bg-clip-content py-px pl-0.5", run.tone)} style={{ height: `calc(${run.count} * var(--diff-line))` }} />
						))}
					</div>
					<div aria-hidden className="shrink-0 py-2 text-muted-foreground/70 select-none">
						{lines.map((line, index) =>
							line ? (
								<Gutter key={index} old={line.row.old} next={line.row.new} sign={line.row.sign.trim()} width={width} className={ROW_TONE[line.row.sign]} signClassName={SIGN_TONE[line.row.sign]} />
							) : (
								<Gutter key={index} old="⋯" next={null} sign={null} width={width} className={GAP} />
							),
						)}
					</div>
					<pre className="code-lines min-w-0 flex-1 overflow-x-auto py-2">
						<code className="block w-max min-w-full">
							{lines.map((line, index) =>
								line ? (
									<div key={index} className={cn("pr-4 pl-0.5", line.row.sign === " " ? "text-muted-foreground" : ROW_TONE[line.row.sign])}>
										{SPOKEN[line.row.sign] && <span className="sr-only select-none">{SPOKEN[line.row.sign]}</span>}
										{line.tokens.length > 0
											? line.tokens.map((token, part) => (
													<span key={part} className={token.className || undefined}>
														{token.text}
													</span>
												))
											: " "}
									</div>
								) : (
									<div key={index} aria-hidden className={GAP}>
										{" "}
									</div>
								),
							)}
						</code>
					</pre>
				</div>
			)}
		</figure>
	);
}
