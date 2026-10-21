/** `AskAboutSelection`: text selected inside its children offers **Ask about this**, which opens the discussion panel on it. */
import { MessageCircleQuestion } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { type DiscussionOrigin, openDiscussion, quoteOf } from "../discussions";
import { useDashboardActions } from "./dashboard-context";
import { rememberFocus } from "./discussion-panel";

interface Anchor {
	quote: string;
	top: number;
	left: number;
}

/** The selection's passage and where under its end the button goes, or `null` when nothing inside `root` is selected. */
function anchorIn(root: HTMLElement): Anchor | null {
	const selection = document.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!root.contains(range.commonAncestorContainer)) return null;
	const quote = quoteOf(selection.toString());
	if (!quote) return null;
	const rects = range.getClientRects();
	const end = rects[rects.length - 1] ?? range.getBoundingClientRect();
	return { quote, top: Math.min(end.bottom + 6, window.innerHeight - 40), left: Math.min(end.right, window.innerWidth - 140) };
}

/** `children` laid out as if this wrapper were not there; a selection within them shows the button by its end. */
export function AskAboutSelection({ origin, children }: { origin: Omit<DiscussionOrigin, "quote">; children: ReactNode }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const { send } = useDashboardActions();

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const update = (): void => setAnchor(anchorIn(root));
		// A selection is read once the drag or the key that made it ends, so the button does not chase the pointer.
		const settled = (): void => void requestAnimationFrame(update);
		const cleared = (): void => {
			if (document.getSelection()?.isCollapsed ?? true) setAnchor(null);
		};
		const hide = (): void => setAnchor(null);
		document.addEventListener("pointerup", settled);
		document.addEventListener("keyup", settled);
		document.addEventListener("selectionchange", cleared);
		root.addEventListener("scroll", hide, true);
		return () => {
			document.removeEventListener("pointerup", settled);
			document.removeEventListener("keyup", settled);
			document.removeEventListener("selectionchange", cleared);
			root.removeEventListener("scroll", hide, true);
		};
	}, []);

	const ask = (): void => {
		if (!anchor) return;
		rememberFocus();
		openDiscussion({ ...origin, quote: anchor.quote }, send);
		// The panel quotes the passage now; a selection left in place would bring the button back on the click's own pointerup.
		document.getSelection()?.removeAllRanges();
		setAnchor(null);
	};

	return (
		<div ref={rootRef} className="contents">
			{children}
			{anchor &&
				createPortal(
					<div className="fixed z-50" style={{ top: anchor.top, left: anchor.left }}>
						<Button
							variant="secondary"
							size="compact"
							leadingIcon={MessageCircleQuestion}
							className="shadow-md"
							aria-label="Ask about this selection"
							// Pressing would otherwise move focus and clear the selection before the click reads them.
							onMouseDown={event => event.preventDefault()}
							onClick={ask}
						>
							Ask about this
						</Button>
					</div>,
					document.body,
				)}
		</div>
	);
}
