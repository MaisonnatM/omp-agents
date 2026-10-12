import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useStoredState } from "../stored-state";
import { Separator, useDragSeparator } from "./drag-separator";

const DEFAULT_WIDTH = 440;
const MIN_LIST = 300;
const MAX_LIST = 720;
/** Narrowest the open item gets beside the list: a narrower page takes the width from the list. */
const MIN_DETAIL = 352;
const STEP = 16;

const clampWidth = (width: number, size: number): number => Math.round(Math.max(MIN_LIST, Math.min(MAX_LIST, size - MIN_DETAIL, width)));

/** What the open item's side shows with nothing open: an icon, a line naming what is missing, and how to open one. */
export interface SplitEmpty {
	icon: LucideIcon;
	title: string;
	hint: ReactNode;
}

interface ListSplitProps {
	/** The localStorage key that keeps the list's width. */
	widthKey: string;
	/** What the line that sizes the list says to a screen reader: "Resize the todo list". */
	resizeLabel: string;
	/** What the open item's side is called: "Open todo". */
	detailLabel: string;
	empty: SplitEmpty;
	list: ReactNode;
	/** The open item, `null` with none open. */
	detail: ReactNode | null;
}

/**
 * The list on the left and the open item on the right, as in Linear, split by a line you drag to size the list.
 * A page too narrow for both shows the list, or the open item in its place.
 */
export function ListSplit({ widthKey, resizeLabel, detailLabel, empty, list, detail }: ListSplitProps) {
	const [width, setWidth] = useStoredState(widthKey, raw => {
		const stored = Number(raw);
		return stored >= MIN_LIST && stored <= MAX_LIST ? stored : DEFAULT_WIDTH;
	});
	const events = useDragSeparator({
		value: width,
		onValue: setWidth,
		axis: "vertical",
		keyStep: STEP,
		shiftSteps: 4,
		min: MIN_LIST,
		max: MAX_LIST,
		reset: DEFAULT_WIDTH,
		size: element => (element.parentElement as HTMLElement).clientWidth,
		clamp: (next, element) => clampWidth(next, (element.parentElement as HTMLElement).clientWidth),
		read: (event, start) => clampWidth(start.value + event.clientX - start.coordinate, start.size),
	});
	const open = detail !== null;
	const { icon: EmptyIcon } = empty;
	// `100%` resolves where the variable is used, against the split's width, so a stored width never squeezes the open item.
	const style = { "--split-list": `min(${width}px, calc(100% - ${MIN_DETAIL}px))` } as CSSProperties;
	return (
		<div style={style} className="@container/split relative flex h-full min-h-0">
			<div className={cn("min-h-0 w-full overflow-y-auto @3xl/split:block @3xl/split:w-(--split-list) @3xl/split:shrink-0", open && "hidden")}>{list}</div>
			<Separator
				{...events}
				axis="vertical"
				label={resizeLabel}
				min={MIN_LIST}
				max={MAX_LIST}
				now={width}
				style={{ left: "var(--split-list)" }}
				className="inset-y-0 hidden w-3 -translate-x-1/2 cursor-col-resize select-none @3xl/split:flex"
			/>
			<aside aria-label={detailLabel} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto @3xl/split:block @3xl/split:border-l @3xl/split:border-border", !open && "hidden")}>
				{detail ?? (
					<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
						<EmptyIcon aria-hidden className="size-6 text-muted-foreground/60" />
						<p>{empty.title}</p>
						<p className="text-xs text-muted-foreground/80">{empty.hint}</p>
					</div>
				)}
			</aside>
		</div>
	);
}
