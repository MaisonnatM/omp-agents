/** Foldable sections that a page keeps folded across reloads, and the reveal of a section or row in them: the inbox's and the tickets page's. */
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useStoredKeys } from "../stored-state";

/** Which of a page's sections show folded, by fold key. */
export interface Folds {
	isFolded: (key: string) => boolean;
	toggle: (key: string) => void;
	unfold: (keys: string[]) => void;
}

/**
 * The folds that localStorage keeps under `storageKey`. It stores the keys you flipped from their default, so a section
 * `foldedByDefault` names stays folded until you unfold it.
 */
export function useFolds(storageKey: string, foldedByDefault: (key: string) => boolean = () => false): Folds {
	const [flipped, flip] = useStoredKeys(storageKey);
	const isFolded = (key: string): boolean => foldedByDefault(key) !== flipped.has(key);
	return { isFolded, toggle: key => flip(key), unfold: keys => flip(...keys.filter(isFolded)) };
}

interface RevealTarget {
	id: string;
	folds: string[];
}

interface RevealOptions {
	/** Once per `token`: a new section choice, or a row id that stays put when its object is rebuilt. */
	token: unknown;
	block: ScrollLogicalPosition;
	focus: boolean;
}

/**
 * Unfolds `target`, then scrolls to it, once per `token`. It waits until the element is in the document, so an unfold
 * that renders it reveals it on the next pass. A section link passes the target itself, so choosing it again scrolls
 * back; a row link passes its id, so folding it again stays folded.
 */
export function useReveal(target: RevealTarget | null, folds: Folds, { token, block, focus }: RevealOptions): void {
	const shown = useRef<unknown>(undefined);
	useEffect(() => {
		if (!target || shown.current === token) return;
		const folded = target.folds.filter(folds.isFolded);
		if (folded.length > 0) return folds.unfold(folded);
		const element = document.getElementById(target.id);
		if (!element) return;
		shown.current = token;
		element.scrollIntoView({ block, behavior: focus ? "auto" : "smooth" });
		if (focus) element.focus({ preventScroll: true });
	});
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
