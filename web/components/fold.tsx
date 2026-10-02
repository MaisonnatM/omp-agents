/** Foldable sections that a page keeps folded across reloads: the inbox's and the tickets page's. */
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SectionTarget } from "../section";

function storedCollapsed(storageKey: string): Set<string> {
	try {
		const keys: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
		return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

/** The folded sections, a toggle, and an unfold for a section the page must show; localStorage keeps them under `storageKey`. */
export function useCollapsed(storageKey: string): [ReadonlySet<string>, (key: string) => void, (keys: string[]) => void] {
	const [collapsed, setCollapsed] = useState(() => storedCollapsed(storageKey));
	const store = (next: Set<string>): void => {
		setCollapsed(next);
		if (next.size === 0) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, JSON.stringify([...next]));
	};
	const toggle = (key: string): void => {
		const next = new Set(collapsed);
		if (!next.delete(key)) next.add(key);
		store(next);
	};
	const expand = (keys: string[]): void => {
		const next = new Set(collapsed);
		if (keys.filter(key => next.delete(key)).length > 0) store(next);
	};
	return [collapsed, toggle, expand];
}

/**
 * Unfolds, scrolls to, and focuses the section a sidebar link last chose, once. It waits for the section to unfold,
 * and for a read that has it to load. Choosing the section again makes a new `target`, which reveals it again.
 */
export function useRevealSection(target: SectionTarget | null, collapsed: ReadonlySet<string>, expand: (keys: string[]) => void): void {
	const revealed = useRef<SectionTarget | null>(null);
	useEffect(() => {
		if (!target || revealed.current === target) return;
		if (target.folds.some(key => collapsed.has(key))) return expand(target.folds);
		const element = document.getElementById(target.id);
		if (!element) return;
		revealed.current = target;
		element.scrollIntoView({ block: "start" });
		element.focus({ preventScroll: true });
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
