/** Foldable sections that a page keeps folded across reloads, and the reveal of a section or row in them: the inbox's and the tickets page's. */
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { SectionTarget } from "../section";

/**
 * Unfolds, scrolls to the top, and focuses the section a sidebar link last chose, once per choice. It waits for the
 * section to unfold, and for a read that has it to load. Choosing the section again makes a new `target`, which reveals
 * it again.
 */
export function useRevealSection(target: SectionTarget | null, collapsed: ReadonlySet<string>, expand: (keys: string[]) => void): void {
	const revealed = useRef<SectionTarget | null>(null);
	useEffect(() => {
		if (!target || revealed.current === target) return;
		const folded = target.folds.filter(key => collapsed.has(key));
		if (folded.length > 0) return expand(folded);
		const element = document.getElementById(target.id);
		if (!element) return;
		revealed.current = target;
		element.scrollIntoView({ block: "start" });
		element.focus({ preventScroll: true });
	});
}

/**
 * Unfolds the sections that list the row a page link named, then scrolls it to the middle, without focus, once per
 * row id: folding it again afterwards stays folded. `row` is `null` while the page does not list it.
 */
export function useRevealRow(row: { id: string; folds: string[] } | null, collapsed: ReadonlySet<string>, expand: (keys: string[]) => void): void {
	/** The row the page already unfolded and scrolled to. */
	const shown = useRef<string | null>(null);
	useEffect(() => {
		if (!row || shown.current === row.id) return;
		// Unfolding renders the row; this effect runs again and then scrolls to it.
		const folded = row.folds.filter(key => collapsed.has(key));
		if (folded.length > 0) return expand(folded);
		shown.current = row.id;
		document.getElementById(row.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [row?.id, row?.folds.join("\n"), collapsed]);
}

interface FoldProps {
	open: boolean;
	onToggle: () => void;
	/** The id of the region the button shows and hides. */
	controls: string;
	children: ReactNode;
	className?: string;
}

export function FoldButton({ open, onToggle, controls, children, className }: FoldProps) {
	return (
		<button
			type="button"
			aria-expanded={open}
			aria-controls={controls}
			onClick={onToggle}
			className={cn("-ml-1 flex min-w-0 items-baseline gap-2 rounded px-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
		>
			<ChevronRight aria-hidden className={cn("size-3.5 shrink-0 self-center transition-transform", open && "rotate-90")} />
			{children}
		</button>
	);
}
