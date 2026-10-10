import { AnimatePresence, motion } from "framer-motion";
import { type FocusEventHandler, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { useRegionHeight } from "@/hooks/use-region-height";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { modHeld } from "../shortcuts";

const NONE: ReadonlySet<string> = new Set();

/** The prompts a gesture on row `index` sends or fills: the marked ones plus that row, in list order, one per line. */
export function chosenText(prompts: readonly string[], marked: ReadonlySet<string>, index: number | null): string {
	return prompts.filter((text, i) => i === index || marked.has(text)).join("\n");
}

/** What a key does to the list: send or fill the marks plus row `index`, move the highlight to `to`, or clear both. */
export type SuggestionKey =
	| { kind: "send"; index: number | null }
	| { kind: "fill"; index: number | null }
	| { kind: "move"; to: number | null }
	| { kind: "clear" };

type KeyPress = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> & { nativeEvent: { isComposing: boolean } };

interface ListState {
	open: boolean;
	count: number;
	/** The highlighted row. */
	active: number | null;
	/** Whether any listed prompt is marked. */
	marked: boolean;
}

/**
 * The list's action for `event`, or null to leave the key to the composer. A digit takes Shift, since some layouts type
 * digits with it.
 */
export function suggestionKey(event: KeyPress, { open, count, active, marked }: ListState): SuggestionKey | null {
	if (!open || event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return null;
	const numbered = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : null;
	if (numbered !== null && numbered < count) return { kind: "send", index: numbered };
	if (event.shiftKey) return null;
	if (event.key === "ArrowDown") return { kind: "move", to: active === null ? 0 : Math.min(active + 1, count - 1) };
	if (event.key === "ArrowUp") return active === null ? null : { kind: "move", to: active === 0 ? null : active - 1 };
	if (active === null && !marked) return null;
	switch (event.key) {
		case "Enter":
			return { kind: "send", index: active };
		case "Tab":
			return { kind: "fill", index: active };
		case "Escape":
			return { kind: "clear" };
		default:
			return null;
	}
}

interface SuggestionRowProps {
	text: string;
	index: number;
	active: boolean;
	marked: boolean;
	optionId: string;
	registerItem: (index: number, element: HTMLElement | null) => void;
	/** Takes the row, or toggles its mark when `mark`. */
	onPick: (mark: boolean) => void;
}

/**
 * A suggested prompt in the listbox under the action bar. It registers itself with the fluid-hover system in an effect,
 * as `MenuItem` does, since an inline ref callback would re-register every render and keep the hook's measurement pass
 * from ever settling.
 */
function SuggestionRow({ text, index, active, marked, optionId, registerItem, onPick }: SuggestionRowProps) {
	const EnterIcon = useIcon("corner-down-left");
	const compactStep = useSize().variant === "compact";
	const ref = useRef<HTMLDivElement>(null);

	useRegisterFluidHoverItem(registerItem, index, ref);

	return (
		<div
			ref={ref}
			id={optionId}
			role="option"
			aria-selected={marked}
			onClick={event => onPick(modHeld(event))}
			className={cn(
				"relative flex cursor-pointer items-center gap-2",
				active || marked ? "text-foreground" : "text-muted-foreground",
				// Text size mirrors the composer's text field: the rows read as prompt candidates, not metadata.
				compactStep ? "h-7 px-2 text-[13px]" : "h-8 px-2.5 text-[14px]",
				"transition-colors duration-80",
			)}
			style={{ fontVariationSettings: fontWeights.normal }}
		>
			{/* The number key that sends this row; filled while the row is marked. */}
			<kbd
				aria-hidden="true"
				className={cn(
					"inline-flex shrink-0 items-center justify-center rounded-[5px] border px-1 font-sans tabular-nums transition-colors duration-80",
					marked ? "border-foreground bg-foreground text-background" : "border-border bg-background",
					compactStep ? "h-4 min-w-4 text-[10px]" : "h-[18px] min-w-[18px] text-[11px]",
				)}
			>
				{index + 1}
			</kbd>
			{/* py-1/-my-1 keeps truncate's overflow:hidden from clipping ascenders/descenders outside the trimmed box. */}
			<span className="min-w-0 flex-1 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1">{text}</span>
			{/* ↵ on the highlighted row: Enter sends it. */}
			<EnterIcon size={13} className={cn("shrink-0 transition-opacity duration-80", active ? "opacity-100" : "opacity-0")} />
		</div>
	);
}

interface SuggestionOptions {
	prompts: string[];
	draft: string;
	/** Sends `text` as the composer's draft would go. */
	onSend: (text: string) => void;
	/** Puts `text` in the composer to edit first. */
	onFill: (text: string) => void;
}

interface Suggestions {
	/** The list under the composer's action bar; nothing while there are no prompts. */
	list: ReactNode;
	/** The text field's `aria-activedescendant` while a row is highlighted. */
	activeId: string | undefined;
	/** Drops the highlight when the text field loses focus. */
	onBlur: FocusEventHandler<HTMLDivElement>;
	/** The composer's keys for the list; call it for a key no shortcut took. */
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Suggested prompts, listed under the composer's action bar while the draft is empty; docs/usage.md describes the keys and
 * clicks. Marks join every send or fill, in list order; Esc, a send, a fill, and the list closing clear them. Focus stays
 * in the text field.
 */
export function useSuggestions({ prompts, draft, onSend, onFill }: SuggestionOptions): Suggestions {
	const open = prompts.length > 0 && draft === "";
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const [regionRef, regionHeight] = useRegionHeight();
	const hover = useFluidHover(listRef);
	const shape = useShape();
	const { activeIndex, setActiveIndex, handlers, registerItem, remeasure } = hover;
	const [marked, setMarked] = useState<ReadonlySet<string>>(NONE);

	// Rows stay registered while the list is closed, so their rects are from a hidden layout: measure again on open.
	useEffect(() => {
		if (open) remeasure();
		else {
			setActiveIndex(null);
			setMarked(NONE);
		}
	}, [open, remeasure, setActiveIndex]);

	const clear = (): void => {
		setActiveIndex(null);
		setMarked(NONE);
	};
	const toggleMark = (text: string): void =>
		setMarked(current => {
			const next = new Set(current);
			if (!next.delete(text)) next.add(text);
			return next;
		});
	const take = (index: number | null, deliver: (text: string) => void): void => {
		clear();
		deliver(chosenText(prompts, marked, index));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const action = suggestionKey(event, { open, count: prompts.length, active: activeIndex, marked: prompts.some(text => marked.has(text)) });
		if (!action) return;
		event.preventDefault();
		switch (action.kind) {
			case "send":
				return take(action.index, onSend);
			case "fill":
				return take(action.index, onFill);
			case "move":
				return setActiveIndex(action.to);
			case "clear":
				return clear();
			default: {
				const never: never = action;
				return never;
			}
		}
	};

	const list = prompts.length > 0 && (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					key="suggestions"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: regionHeight ?? 0, opacity: 1 }}
					// Height-only exit: the region clips shut bottom-up under overflow-hidden, so the divider holds its place until the space closes.
					exit={{ height: 0 }}
					transition={{ ...spring.moderate, bounce: 0 }}
					// -mx-2 cancels the composer's padding so the divider runs its full width. -mt-1 cancels the composer's gap above
					// this region and the listbox's mt-2 restores it inside the collapsible area, so the gap animates with the height.
					className="-mx-2 -mt-1 overflow-hidden"
				>
					<div
						ref={element => {
							listRef.current = element;
							regionRef(element);
						}}
						role="listbox"
						id={listId}
						aria-label="Suggested prompts"
						aria-multiselectable="true"
						onMouseEnter={handlers.onMouseEnter}
						onMouseMove={handlers.onMouseMove}
						onMouseLeave={handlers.onMouseLeave}
						onClick={handlers.onClick}
						className="relative mt-2 flex flex-col border-t border-border/60 px-1.5 pt-1.5"
					>
						<FluidHoverHighlight hover={hover} className={shape.bg} />
						{prompts.map((text, index) => (
							<SuggestionRow
								key={`${text}-${index}`}
								text={text}
								index={index}
								active={index === activeIndex}
								marked={marked.has(text)}
								optionId={`${listId}-${index}`}
								registerItem={registerItem}
								// The composer's frame keeps the text field focused on a mousedown here, so marking never moves focus.
								onPick={mark => (mark ? toggleMark(text) : take(index, onSend))}
							/>
						))}
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
	return { list, activeId: activeIndex === null ? undefined : `${listId}-${activeIndex}`, onBlur: () => setActiveIndex(null), onKeyDown };
}
