import { cn } from "@/lib/utils";
import type { BoardNote } from "../../../templates/omp/agent/extensions/board/log";

/** A merge the Board ran for the user's "Merge on main", as a line of its thread: what landed, or why it did not, which reopens the Board task. */
export function MergeNote({ note }: { note: Extract<BoardNote, { kind: "landed" | "land-failed" }> }) {
	return (
		<div className="px-5 py-2 text-[13px]">
			<div className={cn("font-medium", note.kind === "land-failed" && "text-destructive")}>{note.kind === "landed" ? "The Board merged this on main" : "The Board's merge failed; a new session takes it"}</div>
			<div className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{note.text}</div>
		</div>
	);
}
