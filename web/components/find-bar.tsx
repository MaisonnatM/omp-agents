/**
 * The find bar, as a browser's Cmd+F: it highlights every match of its text in one part of the page, such as a
 * conversation or a pull request's details, steps through them with Enter and Shift+Enter, and follows that part as it changes.
 */
import { useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { createContext, type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { findMatches } from "../find-matches";
import { chordLabel, useShortcuts } from "../shortcuts";

/** Whether the transcript sits in the focused pane, the one Cmd+F searches; a Bot's page has one, so it defaults to yes. */
export const PaneFocused = createContext(true);

/** The `::highlight()` names `web/globals.css` paints. One find bar shows at a time: each closes when its part of the page leaves focus. */
const MATCHES = "find-matches";
const CURRENT = "find-current";

/** How far inside the viewport's edges a match must sit to count as in view. */
const EDGE = 48;

/** The nearest element that scrolls `inside`, such as the transcript's viewport or a pull request tab's scroller. */
function scrollerOf(inside: Element | null): HTMLElement | null {
	for (let element = inside?.parentElement ?? null; element; element = element.parentElement) {
		const { overflowY } = getComputedStyle(element);
		if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight) return element;
	}
	return null;
}

/**
 * The text nodes under `root` that show, in document order: a folded group's or a hidden tab's text is not on screen to
 * find, and the find bar's own count is not part of what it searches.
 */
function shownText(root: HTMLElement): Text[] {
	const shown = new Map<Element, boolean>();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
			let visible = shown.get(parent);
			if (visible === undefined) shown.set(parent, (visible = !parent.closest("[data-find-bar]") && parent.checkVisibility()));
			return visible ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	return nodes;
}

function rangesFor(root: HTMLElement, query: string): Range[] {
	const nodes = shownText(root);
	return findMatches(nodes.map(node => node.data), query).map(({ start, end }) => {
		const range = new Range();
		range.setStart(nodes[start[0]]!, start[1]);
		range.setEnd(nodes[end[0]]!, end[1]);
		return range;
	});
}

/** The first match from the top of its scroller's view down, so a new query starts where the reader is. */
function firstInView(ranges: readonly Range[]): number {
	const viewport = ranges[0] && scrollerOf(ranges[0].startContainer.parentElement);
	if (!viewport) return 0;
	const top = viewport.getBoundingClientRect().top;
	const index = ranges.findIndex(range => range.getBoundingClientRect().top >= top);
	return Math.max(0, index);
}

/** Scrolls the match's own scroller alone, as the minimap does, until `range` sits a third of the way down, unless it already shows. */
function reveal(range: Range, reduceMotion: boolean): void {
	const viewport = scrollerOf(range.startContainer.parentElement);
	if (!viewport) return;
	const box = viewport.getBoundingClientRect();
	const rect = range.getBoundingClientRect();
	if (rect.top >= box.top + EDGE && rect.bottom <= box.bottom - EDGE) return;
	viewport.scrollTo({ top: viewport.scrollTop + rect.top - box.top - box.height / 3, behavior: reduceMotion ? "auto" : "smooth" });
}

/** The text selected inside `root` on one line, which Cmd+F searches for, as a browser does. */
function selectedIn(root: HTMLElement): string {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode)) return "";
	const text = selection.toString();
	return text.includes("\n") ? "" : text;
}

interface FindBarProps {
	/** What the bar searches. */
	root: RefObject<HTMLElement | null>;
	/** Whether Cmd+F opens this bar: its part of the page has focus, such as the focused pane. Turning it off closes the bar. */
	enabled: boolean;
	/** The field's accessible name and placeholder, such as `Find in conversation`. */
	label: string;
	/** Places the bar over `root`; the bar sits at its right end. */
	className: string;
}

export function FindBar({ root: rootRef, enabled, label, className }: FindBarProps) {
	const reduceMotion = useReducedMotion() ?? false;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [ranges, setRanges] = useState<Range[]>([]);
	const [current, setCurrent] = useState(0);
	// Each Cmd+F puts the cursor back in the field; each step or new query scrolls to the current match, and a streamed
	// token, which only finds the matches again, scrolls nothing.
	const [asked, setAsked] = useState(0);
	const [revealed, setRevealed] = useState(0);
	const input = useRef<HTMLInputElement>(null);

	useShortcuts({
		find: () => {
			const root = rootRef.current;
			// Another pane's transcript, or one a hidden page keeps, leaves the key to the one in view.
			if (!enabled || !root?.checkVisibility()) return false;
			const selected = selectedIn(root);
			if (selected) setQuery(selected);
			setOpen(true);
			setAsked(count => count + 1);
		},
	});

	useEffect(() => {
		if (!enabled) setOpen(false);
	}, [enabled]);

	useEffect(() => {
		if (asked === 0) return;
		input.current?.focus();
		input.current?.select();
	}, [asked]);

	useEffect(() => {
		const root = rootRef.current;
		if (!open || !root || query.trim() === "") {
			setRanges([]);
			return;
		}
		const found = rangesFor(root, query);
		setRanges(found);
		setCurrent(firstInView(found));
		setRevealed(count => count + 1);
		let frame = 0;
		const observer = new MutationObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const again = rangesFor(root, query);
				setRanges(again);
				setCurrent(index => Math.min(index, Math.max(0, again.length - 1)));
			});
		});
		observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-state", "hidden", "open"] });
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [open, query, rootRef]);

	useEffect(() => {
		if (ranges.length === 0) return;
		CSS.highlights.set(MATCHES, new Highlight(...ranges));
		const shown = ranges[current];
		if (shown) CSS.highlights.set(CURRENT, new Highlight(shown));
		return () => {
			CSS.highlights.delete(MATCHES);
			CSS.highlights.delete(CURRENT);
		};
	}, [ranges, current]);

	// Reads the ranges through a ref, so a streamed token that finds them again does not scroll the reader away.
	const latest = useRef({ ranges, current });
	latest.current = { ranges, current };
	useEffect(() => {
		const range = latest.current.ranges[latest.current.current];
		if (revealed > 0 && range) reveal(range, reduceMotion);
	}, [revealed, reduceMotion]);

	if (!open) return null;
	const count = ranges.length;
	const step = (by: 1 | -1): void => {
		if (count === 0) return;
		setCurrent(index => (index + by + count) % count);
		setRevealed(times => times + 1);
	};
	const missing = query.trim() !== "" && count === 0;
	const status = query.trim() === "" ? "" : missing ? "No results" : `${current + 1} of ${count}`;
	return (
		<div data-find-bar className={cn("pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-end", className)}>
			<div
				role="search"
				className={cn(
					"pointer-events-auto flex h-9 w-96 max-w-full items-center gap-1.5 rounded-2xl border border-border bg-popover/95 pr-1 pl-3 text-popover-foreground shadow-sm backdrop-blur focus-within:ring-1 focus-within:ring-[color:var(--focus-ring,#6B97FF)]",
					missing && "border-destructive/60 focus-within:ring-destructive/60",
				)}
			>
				<Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
				<input
					ref={input}
					type="text"
					aria-label={label}
					placeholder={label}
					value={query}
					onChange={event => setQuery(event.target.value)}
					onKeyDown={event => {
						if (event.key === "Enter") {
							event.preventDefault();
							step(event.shiftKey ? -1 : 1);
						} else if (event.key === "Escape") {
							event.preventDefault();
							setOpen(false);
						}
					}}
					className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				/>
				<span aria-live="polite" className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
					{status}
				</span>
				<Tooltip content="Previous match" shortcut={[chordLabel({ key: "Enter", shift: true })]} side="bottom" disabled={count === 0}>
					<Button {...activityControl("find-bar.step")} variant="ghost" size="icon-compact" aria-label="Previous match" disabled={count === 0} onClick={() => step(-1)}>
						<ChevronUp />
					</Button>
				</Tooltip>
				<Tooltip content="Next match" shortcut={[chordLabel({ key: "Enter" })]} side="bottom" disabled={count === 0}>
					<Button {...activityControl("find-bar.step")} variant="ghost" size="icon-compact" aria-label="Next match" disabled={count === 0} onClick={() => step(1)}>
						<ChevronDown />
					</Button>
				</Tooltip>
				<span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
				<Tooltip content="Close" shortcut={[chordLabel({ key: "Escape" })]} side="bottom">
					<Button {...activityControl("find-bar.close")} variant="ghost" size="icon-compact" aria-label="Close" onClick={() => setOpen(false)}>
						<X />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}
