/** The Code tab's controls inside the shared diff, which reach the pull request through {@link CodeControlsContext}. */
import { MessageSquarePlus } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { MAX_COMMENT_BODY } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import type { LineComment } from "../../../diff-options";
import { useAction } from "../../../use-action";
import type { LineCommentSlotProps } from "../../changes/diff-review";
import { toasts } from "../../toaster";

export interface CodeControls {
	/** Adds the comment to the pull request's Review draft; rejects with why the draft refused it. */
	addComment: (path: string, comment: LineComment) => Promise<void>;
}

export const CodeControlsContext = createContext<CodeControls | null>(null);

function useCodeControls(): CodeControls {
	const value = useContext(CodeControlsContext);
	if (!value) throw new Error("useCodeControls must be used within the Code tab's CodeControlsContext.Provider");
	return value;
}

/** The bar under the lines picked in a diff, and the form that adds a comment on them to the Review draft. */
export function LineCommentBox({ path, range, onClose }: LineCommentSlotProps) {
	const { addComment } = useCodeControls();
	const [writing, setWriting] = useState(false);
	const [body, setBody] = useState("");
	const add = useAction(async () => {
		await addComment(path, { line: range.end, startLine: range.start === range.end ? null : range.start, side: range.side, body: body.trim() });
		toasts.add({ title: "Comment added to Review draft" });
		onClose();
	}, "Could not add the comment");
	const lines = range.start === range.end ? `line ${range.end}` : `lines ${range.start}–${range.end}`;
	return (
		<div className="sticky left-0 z-10 border-y border-border bg-background p-2 font-sans text-xs">
			<div className="flex items-center gap-2">
				<span>
					{range.side === "LEFT" ? "Old" : "New"} {lines}
				</span>
				<Button size="xs" variant="outline" leadingIcon={MessageSquarePlus} onClick={() => setWriting(true)}>
					Add comment
				</Button>
				<Button size="xs" variant="ghost" onClick={onClose}>
					Cancel
				</Button>
			</div>
			{writing && (
				<form
					className="mt-2 space-y-2"
					onSubmit={event => {
						event.preventDefault();
						if (body.trim()) add.run();
					}}
				>
					<textarea
						autoFocus
						aria-label="Line comment"
						value={body}
						maxLength={MAX_COMMENT_BODY}
						onChange={event => setBody(event.target.value)}
						onKeyDown={event => {
							if (event.nativeEvent.isComposing) return;
							if (event.key === "Escape") {
								event.preventDefault();
								setWriting(false);
							} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								event.currentTarget.form?.requestSubmit();
							}
						}}
						className="block min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
					/>
					<p className="text-muted-foreground">Saved locally in Review draft. Nothing is posted to GitHub.</p>
					<Button type="submit" size="xs" variant="secondary" disabled={!body.trim() || add.pending}>
						Add to review draft
					</Button>
				</form>
			)}
		</div>
	);
}
