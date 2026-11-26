import { cn } from "@/lib/utils";
import type { BoardNote } from "../../../templates/omp/agent/extensions/board/log";

/** The Board's notes a thread shows between the replies: the merges it ran or refused, a session that did not start, and your closing the Board task; the rest, such as a claim or a wake, stay out. */
export type ThreadNote = Extract<BoardNote, { kind: "landed" | "land-failed" | "land-refused" | "start-failed" | "closed" }>;

const THREAD_NOTES: Record<ThreadNote["kind"], true> = { landed: true, "land-failed": true, "land-refused": true, "start-failed": true, closed: true };

export const isThreadNote = (note: BoardNote): note is ThreadNote => note.kind in THREAD_NOTES;

/** What a {@link ThreadNote} says: its line, whether it reads as a failure, and the text under it. */
function describe(note: ThreadNote): { line: string; failed: boolean; text: string | null } {
	switch (note.kind) {
		case "landed":
			return { line: "The Board merged this on main", failed: false, text: note.text };
		case "land-failed":
			return { line: "The Board's merge failed; a new session takes it", failed: true, text: note.text };
		case "land-refused":
			return { line: "The Board did not merge this", failed: false, text: note.text };
		case "start-failed":
			return { line: "The session did not start", failed: true, text: note.error };
		case "closed":
			return { line: "You closed this Board task", failed: false, text: null };
	}
}

/** A line of a Board thread the Board wrote, with its detail under it. */
export function BoardNoteLine({ note }: { note: ThreadNote }) {
	const { line, failed, text } = describe(note);
	return (
		<div className="px-5 py-2 text-[13px]">
			<div className={cn("font-medium", failed ? "text-destructive" : "text-muted-foreground")}>{line}</div>
			{text && <div className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{text}</div>}
		</div>
	);
}
