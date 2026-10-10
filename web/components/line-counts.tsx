/** `+12 −3`, the lines added and removed; a zero or unknown (`null`) part is left out, and nothing renders when both are. */
export function LineCounts({ added, removed }: { added: number | null; removed: number | null }) {
	if (!added && !removed) return null;
	return (
		<span className="shrink-0 font-mono text-[11px] whitespace-nowrap tabular-nums">
			{!!added && (
				<span className="text-emerald-600 dark:text-emerald-400">
					+{added}
					<span className="sr-only"> added</span>
				</span>
			)}
			{!!added && !!removed && " "}
			{!!removed && (
				<span className="text-red-600 dark:text-red-400">
					−{removed}
					<span className="sr-only"> removed</span>
				</span>
			)}
		</span>
	);
}
