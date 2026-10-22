import { type RefObject, useEffect, useRef, useState } from "react";
import type { ChangedEntry } from "../../../src/shared/changes";
import { useShortcuts } from "../../shortcuts";
import type { DiffStackHandle } from "./diff-stack";
import type { FileOpen } from "./file-tree";

export interface FileCursor {
	/** The `DiffStack` the cursor scrolls. */
	stack: RefObject<DiffStackHandle | null>;
	/** The marked file, the first while none is. */
	entry: ChangedEntry | null;
	/** Marks a file, scrolls the stack to it, and tells the opener. */
	open: (path: string) => void;
	/** Marks a file without scrolling, as the stack reports the one at the top of the view. */
	setCurrent: (path: string) => void;
}

/**
 * The file a changes explorer marks: the one asked for, then the one at the top of the diffs as you scroll them; ↓ and ↑
 * step through `order`.
 */
export function useFileCursor(order: readonly ChangedEntry[], path: string | null, opener: FileOpen): FileCursor {
	const [current, setCurrent] = useState(path);
	const stack = useRef<DiffStackHandle>(null);
	useEffect(() => {
		setCurrent(path);
		if (path !== null) stack.current?.scrollTo(path);
	}, [path]);
	const entry = order.find(file => file.path === current) ?? order[0] ?? null;
	const open = (next: string): void => {
		setCurrent(next);
		stack.current?.scrollTo(next);
		if (opener.hrefFor && !opener.onPick) location.hash = opener.hrefFor(next);
		else opener.onPick?.(next);
	};
	const step = (by: 1 | -1): boolean => {
		if (!entry) return false;
		const next = order[order.indexOf(entry) + by];
		if (next) open(next.path);
		return true;
	};
	useShortcuts({ nextChangedFile: () => step(1), previousChangedFile: () => step(-1) });
	return { stack, entry, open, setCurrent };
}
