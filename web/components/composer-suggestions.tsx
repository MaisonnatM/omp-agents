import { AnimatePresence, motion } from "framer-motion";
import { type FocusEventHandler, type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useRegionHeight } from "@/components/ui/input-message";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

interface SuggestionRowProps {
	text: string;
	index: number;
	active: boolean;
	optionId: string;
	registerItem: (index: number, element: HTMLElement | null) => void;
	onSelect: () => void;
}

/**
 * A suggested prompt in the listbox under the action bar. It registers itself with the fluid-hover system in an effect,
 * as `MenuItem` does, since an inline ref callback would re-register every render and keep the hook's measurement pass
 * from ever settling.
 */
function SuggestionRow({ text, index, active, optionId, registerItem, onSelect }: SuggestionRowProps) {
	const EnterIcon = useIcon("corner-down-left");
	const compactStep = useSize().variant === "compact";
	const ref = useRef<HTMLDivElement>(null);

	useRegisterFluidHoverItem(registerItem, index, ref);

	return (
		<div
			ref={ref}
			id={optionId}
			role="option"
			aria-selected={active}
			onClick={onSelect}
			className={cn(
				"relative flex cursor-pointer items-center gap-2",
				active ? "text-foreground" : "text-muted-foreground",
				// Text size mirrors the composer's text field: the rows read as prompt candidates, not metadata.
				compactStep ? "h-7 px-2 text-[13px]" : "h-8 px-2.5 text-[14px]",
				"transition-colors duration-80",
			)}
			style={{ fontVariationSettings: fontWeights.normal }}
		>
			{/* The number key that sends this row. */}
			<kbd
				aria-hidden="true"
				className={cn(
					"inline-flex shrink-0 items-center justify-center rounded-[5px] border border-border bg-background px-1 font-sans tabular-nums",
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
 * Suggested prompts, listed under the composer's action bar while the draft is empty. A row's number key sends it,
 * Shift allowed since some layouts type digits with it. A digit sends even with no row highlighted, so a message of
 * your own that starts with one needs another character first: the user chose speed over that. ArrowDown moves a
 * highlight into the list, ArrowUp walks it back up and out, Enter or a click sends the highlighted prompt, Tab fills it
 * to edit first, and Esc drops the highlight. Focus stays in the text field.
 */
export function useSuggestions({ prompts, draft, onSend, onFill }: SuggestionOptions): Suggestions {
	const open = prompts.length > 0 && draft === "";
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const [regionRef, regionHeight] = useRegionHeight();
	const hover = useFluidHover(listRef);
	const shape = useShape();
	const { activeIndex, setActiveIndex, handlers, registerItem, remeasure } = hover;

	// Rows stay registered while the list is closed, so their rects are from a hidden layout: measure again on open.
	useEffect(() => {
		if (open) remeasure();
		else setActiveIndex(null);
	}, [open, remeasure, setActiveIndex]);

	const send = (text: string): void => {
		setActiveIndex(null);
		onSend(text);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (!open || event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
		const numbered = /^[1-9]$/.test(event.key) ? prompts[Number(event.key) - 1] : undefined;
		if (numbered !== undefined) {
			event.preventDefault();
			send(numbered);
			return;
		}
		if (event.shiftKey) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex(index => (index === null ? 0 : Math.min(index + 1, prompts.length - 1)));
			return;
		}
		if (activeIndex === null) return;
		const active = prompts[activeIndex];
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex(activeIndex === 0 ? null : activeIndex - 1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			send(active);
		} else if (event.key === "Tab") {
			event.preventDefault();
			setActiveIndex(null);
			onFill(active);
		} else if (event.key === "Escape") {
			event.preventDefault();
			setActiveIndex(null);
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
								optionId={`${listId}-${index}`}
								registerItem={registerItem}
								onSelect={() => send(text)}
							/>
						))}
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
	return { list, activeId: activeIndex === null ? undefined : `${listId}-${activeIndex}`, onBlur: () => setActiveIndex(null), onKeyDown };
}
