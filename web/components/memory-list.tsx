/** `MemoryList`, the facts a `remember` tool kept, for a Bot's details and a personal session's. */
import { useId } from "react";
import { memoryEntries } from "../bots-model";

interface MemoryListProps {
	/** The memory file, as the heading names it. */
	path: string;
	/** The memory file's text. */
	memory: string;
	/** What shows before anything is remembered. */
	empty: string;
}

/** The facts kept in `path`, which only a `remember` tool writes. */
export function MemoryList({ path, memory, empty }: MemoryListProps) {
	const id = useId();
	const entries = memoryEntries(memory);
	return (
		<section aria-labelledby={id} className="space-y-2">
			<h3 id={id} className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
				Memory
				<span className="truncate font-mono font-normal">{path}</span>
			</h3>
			{entries.length === 0 ? (
				<p className="text-xs text-muted-foreground">{empty}</p>
			) : (
				<ul className="space-y-1.5">
					{entries.map((entry, index) => (
						<li key={index} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
							<p className="break-words">{entry.fact}</p>
							{entry.date && <p className="text-xs tabular-nums text-muted-foreground">{entry.date}</p>}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
