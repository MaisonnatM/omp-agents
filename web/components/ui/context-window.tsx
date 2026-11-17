import { cn } from "@/lib/utils";

/** How full the window reads: `warn` is filling, `full` is nearly out of room. */
export type ContextLevel = "ok" | "warn" | "full";

export const formatTokens = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format;

const CELLS = 144;
const COLUMNS = 24;

const LEVEL_CLASS: Record<ContextLevel, { cell: string; pill: string; caption: string }> = {
	ok: { cell: "bg-primary/75", pill: "bg-muted text-muted-foreground", caption: "text-muted-foreground" },
	warn: { cell: "bg-warning", pill: "bg-warning-surface text-warning-foreground", caption: "text-warning-foreground" },
	full: { cell: "bg-destructive", pill: "bg-destructive/10 text-destructive-foreground", caption: "text-destructive-foreground" },
};

/** What fills a session's context window: the used tokens as a figure and a field of cells, one per `limit / 144` tokens, with what is left under it. */
export function ContextWindow({ tokens, limit, level, autoAt, busy }: {
	tokens: number;
	limit: number;
	level: ContextLevel;
	/** Share of the window at which omp compacts on its own; `null` when it does not. */
	autoAt: number | null;
	/** Compaction is running: the used cells pulse. */
	busy: boolean;
}) {
	const used = limit > 0 ? Math.min(tokens / limit, 1) : 1;
	const filled = tokens > 0 ? Math.max(1, Math.round(used * CELLS)) : 0;
	const left = Math.max(0, limit - tokens);
	const tone = LEVEL_CLASS[level];
	return (
		<div className="flex flex-col gap-2.5 px-2 pt-1.5 pb-2">
			<span className="text-sm font-medium">Context window</span>
			<div className="flex items-center gap-2">
				<span aria-hidden className="text-2xl font-medium tracking-tight tabular-nums">{formatTokens(tokens)}</span>
				<span aria-hidden className="min-w-0 flex-1 truncate pt-1 text-xs text-muted-foreground">of {formatTokens(limit)} tokens</span>
				<span aria-hidden className={cn("h-5 shrink-0 rounded-sm px-1.5 text-xs font-medium leading-5 tabular-nums transition-colors duration-300", tone.pill)}>{Math.round(used * 100)}%</span>
				<span className="sr-only">{formatTokens(tokens)} of {formatTokens(limit)} tokens used, {Math.round(used * 100)} percent</span>
			</div>
			<div aria-hidden className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
				{Array.from({ length: CELLS }, (_, index) => (
					<span
						key={index}
						className={cn(
							"aspect-square rounded-[2px] transition-colors duration-300 motion-reduce:transition-none",
							index < filled ? tone.cell : "bg-foreground/6",
							busy && index < filled && "motion-safe:animate-pulse",
						)}
						style={{ transitionDelay: `${index * 2}ms`, animationDelay: busy ? `${index * 15}ms` : undefined }}
					/>
				))}
			</div>
			<span className={cn("text-xs tabular-nums", busy ? "text-muted-foreground" : tone.caption)}>
				{busy ? "Compacting…" : `${formatTokens(left)} ${level === "ok" ? "free" : "left"}`}
				{autoAt !== null && <span className="text-muted-foreground"> · auto-compacts at {Math.round(autoAt * 100)}%</span>}
			</span>
		</div>
	);
}
