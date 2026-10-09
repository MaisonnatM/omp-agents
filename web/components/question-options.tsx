import { AnimatePresence, motion } from "framer-motion";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { SelectionBackgrounds, useMergeSplitBlocks, useSelectionRuns } from "@/hooks/use-merge-split";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

/** One row of a question: its title, and a muted description after it or under it. */
export interface QuestionOption {
	title: string;
	description?: string;
}

/** `inline` puts a row's description after its title on one line; `stacked` puts it under, for descriptions that wrap. */
export type OptionLayout = "inline" | "stacked";

interface OptionRowProps {
	index: number;
	option: QuestionOption;
	layout: OptionLayout;
	selected: boolean;
	/** Hovered or focused: the row's number gives way to the submit arrow. */
	active: boolean;
	tabIndex: number;
	arrow: ReactNode;
	registerItem: (index: number, element: HTMLElement | null) => void;
	onPick: () => void;
}

/** One radio row: its title and description, then the number that picks it, which turns into an arrow while the row is active. */
function OptionRow({ index, option, layout, selected, active, tabIndex, arrow, registerItem, onPick }: OptionRowProps) {
	const ref = useRef<HTMLDivElement>(null);
	const shape = useShape();
	const size = useSize();
	const compact = size.variant === "compact";
	const stacked = layout === "stacked";

	useRegisterFluidHoverItem(registerItem, index, ref);

	// The invisible semibold copy reserves the selected title's width, so selecting a row never reflows it.
	const title = (
		<span className="inline-grid">
			<span className="col-start-1 row-start-1 invisible" style={{ fontVariationSettings: fontWeights.semibold }} aria-hidden="true">
				{option.title}
			</span>
			<span
				className="col-start-1 row-start-1 text-foreground transition-[color,font-variation-settings] duration-80"
				style={{ fontVariationSettings: selected ? fontWeights.semibold : fontWeights.medium }}
			>
				{option.title}
			</span>
		</span>
	);

	return (
		<div
			ref={ref}
			data-fluid-hover-index={index}
			data-state={selected ? "checked" : "unchecked"}
			role="radio"
			aria-checked={selected}
			tabIndex={tabIndex}
			onClick={onPick}
			onKeyDown={event => {
				if ((event.key === " " || event.key === "Enter") && !event.metaKey && !event.ctrlKey) {
					event.preventDefault();
					onPick();
				}
			}}
			className={cn(
				"relative z-10 flex cursor-pointer select-none outline-none gap-3 pl-3 pr-1.5",
				// A stacked row's number tracks its title's line instead of the row's middle.
				stacked ? "items-start" : "items-center",
				stacked ? (compact ? "min-h-12 py-1.5" : "min-h-14 py-2") : compact ? "min-h-8 py-1" : "min-h-10 py-1.5",
				shape.item,
			)}
		>
			<span
				className={cn(
					"min-w-0 flex-1 leading-snug",
					size.text,
					stacked ? "flex flex-col gap-0.5" : "inline-flex items-center gap-0",
				)}
			>
				{stacked ? (
					<>
						{title}
						{option.description && (
							<span className={cn(compact ? "text-[11px]" : "text-[12px]", "text-muted-foreground leading-snug")}>{option.description}</span>
						)}
					</>
				) : (
					<span>
						{title}
						{option.description && (
							<>
								{" "}
								<span className="text-muted-foreground">{option.description}</span>
							</>
						)}
					</span>
				)}
			</span>
			<span className={cn("shrink-0 relative inline-flex items-center justify-center", compact ? "w-6 h-6" : "w-7 h-7", stacked && "-mt-[1px]")}>
				<span
					aria-hidden
					className={cn(
						"absolute inline-flex items-center justify-center text-[11px] transition-[opacity,font-variation-settings] duration-80",
						compact ? "w-[18px] h-[18px]" : "w-5 h-5",
						selected ? "text-foreground" : "text-muted-foreground",
						active && "opacity-0",
					)}
					style={{ fontVariationSettings: selected ? fontWeights.semibold : fontWeights.medium }}
				>
					{index + 1}
				</span>
				<AnimatePresence>
					{active && (
						<motion.span
							aria-hidden
							className={cn("absolute inset-0 inline-flex items-center justify-center bg-foreground text-background", shape.bg)}
							initial={{ opacity: 0, scale: 0.6 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.6, transition: spring.fast.exit }}
							transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
						>
							{arrow}
						</motion.span>
					)}
				</AnimatePresence>
			</span>
		</div>
	);
}

interface QuestionOptionsProps {
	options: QuestionOption[];
	layout: OptionLayout;
	/** Indices of the rows shown checked. */
	selected: readonly number[];
	/** The id of the question's title, which names the radio group. */
	labelledBy: string;
	onPick: (index: number) => void;
}

/**
 * A question's rows as one radio group. Pointer hover and keyboard focus light the same fluid highlight, checked rows
 * share merged backgrounds, and a ring follows keyboard focus only. ↑, ↓, Home, and End move between rows, Enter or
 * Space picks one, and Tab enters the group at its first checked row, else its first.
 */
export function QuestionOptions({ options, layout, selected, labelledBy, onPick }: QuestionOptionsProps) {
	const shape = useShape();
	const ArrowRight = useIcon("arrow-right");
	const containerRef = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(containerRef);
	const { activeIndex, setActiveIndex, itemRects, handlers, registerItem } = hover;
	// The keyboard-focused row, which draws the ring; a click focuses a row without it.
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const blocks = useMergeSplitBlocks(useSelectionRuns(selected), itemRects, shape.bgRadius);
	const focusRect = focusedIndex === null ? undefined : itemRects[focusedIndex];
	const firstSelected = options.findIndex((_, index) => selected.includes(index));
	const tabStop = firstSelected === -1 ? 0 : firstSelected;

	const moveTo = (index: number): void => {
		setActiveIndex(index);
		containerRef.current?.querySelector<HTMLElement>(`[data-fluid-hover-index="${index}"]`)?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		// Fluid's ← and → step between questions; with one question they do nothing, but still stop here.
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (options.length === 0) return;
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Home") moveTo(0);
		else if (event.key === "End") moveTo(options.length - 1);
		else {
			const next = (activeIndex ?? -1) + (event.key === "ArrowDown" ? 1 : -1);
			moveTo((next + options.length) % options.length);
		}
	};

	return (
		<div
			ref={containerRef}
			role="radiogroup"
			aria-labelledby={labelledBy}
			onMouseEnter={handlers.onMouseEnter}
			onMouseMove={handlers.onMouseMove}
			onMouseLeave={handlers.onMouseLeave}
			onClick={handlers.onClick}
			onFocus={event => {
				const target = event.target as HTMLElement;
				const row = target.closest("[data-fluid-hover-index]");
				if (!row) return;
				const index = Number(row.getAttribute("data-fluid-hover-index"));
				setActiveIndex(index);
				setFocusedIndex(target.matches(":focus-visible") ? index : null);
			}}
			onBlur={event => {
				// Moving between rows keeps the indicators mounted, so they morph instead of fading out and in.
				if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
				setFocusedIndex(null);
				setActiveIndex(null);
			}}
			onKeyDown={onKeyDown}
			className="relative flex flex-col -mx-3"
		>
			{/* Under the checked backgrounds, so a hovered checked row still reads as checked. */}
			<FluidHoverHighlight hover={hover} className={shape.bg} />
			<SelectionBackgrounds blocks={blocks} />
			<AnimatePresence>
				{focusRect && (
					<motion.div
						aria-hidden
						className={cn("absolute pointer-events-none border border-[color:var(--focus-ring,#6B97FF)] z-20", shape.focusRing)}
						initial={{
							opacity: 0,
							top: focusRect.top - 2,
							left: focusRect.left - 2,
							width: focusRect.width + 4,
							height: focusRect.height + 4,
						}}
						animate={{
							opacity: 1,
							top: focusRect.top - 2,
							left: focusRect.left - 2,
							width: focusRect.width + 4,
							height: focusRect.height + 4,
						}}
						exit={{ opacity: 0, transition: spring.fast.exit }}
						transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
					/>
				)}
			</AnimatePresence>
			{options.map((option, index) => (
				<OptionRow
					// A request's rows never reorder, and their titles may repeat.
					key={index}
					index={index}
					option={option}
					layout={layout}
					selected={selected.includes(index)}
					active={activeIndex === index}
					tabIndex={index === tabStop ? 0 : -1}
					arrow={<ArrowRight size={14} strokeWidth={2} className="h-3.5 w-3.5" />}
					registerItem={registerItem}
					onPick={() => onPick(index)}
				/>
			))}
		</div>
	);
}
