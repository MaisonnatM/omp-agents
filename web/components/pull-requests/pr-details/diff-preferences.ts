import { useMemo } from "react";
import type { DiffOptions } from "../../../diff-options";
import { useStoredState } from "../../../stored-state";

const LAYOUT_KEY = "omp-agents.pr-diff-layout";
const WRAP_KEY = "omp-agents.pr-diff-wrap";
const WHITESPACE_KEY = "omp-agents.pr-diff-whitespace";
const TREE_KEY = "omp-agents.pr-file-tree";

export interface DiffPreferences {
	options: DiffOptions;
	change: (next: Partial<DiffOptions>) => void;
	treeOpen: boolean;
	toggleTree: () => void;
}

/** How the Code tab shows its diffs, and whether its file tree shows, kept on this computer. */
export function useDiffPreferences(): DiffPreferences {
	const [layout, setLayout] = useStoredState<DiffOptions["layout"]>(LAYOUT_KEY, raw => (raw === "split" ? "split" : "stacked"));
	const [wrap, setWrap] = useStoredState(WRAP_KEY, raw => raw === "true");
	const [ignoreWhitespace, setIgnoreWhitespace] = useStoredState(WHITESPACE_KEY, raw => raw === "true");
	const [treeOpen, setTreeOpen] = useStoredState(TREE_KEY, raw => raw !== "false");
	const options = useMemo(() => ({ layout, wrap, ignoreWhitespace }), [layout, wrap, ignoreWhitespace]);
	const change = (next: Partial<DiffOptions>): void => {
		if (next.layout !== undefined) setLayout(next.layout);
		if (next.wrap !== undefined) setWrap(next.wrap);
		if (next.ignoreWhitespace !== undefined) setIgnoreWhitespace(next.ignoreWhitespace);
	};
	return { options, change, treeOpen, toggleTree: () => setTreeOpen(open => !open) };
}
