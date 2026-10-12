import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ShortcutId, shortcutLabels } from "../shortcuts";
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

/**
 * A control on a {@link DetailBar}: a button the bar's owner fires, with `href` for one that is a link, or `onClick` that
 * is `undefined` to mark the button as disabled.
 */
export type BarAction =
	| { label: string; icon: ReactNode; shortcut?: ShortcutId; href: string; onClick?: never }
	| { label: string; icon: ReactNode; shortcut?: ShortcutId; onClick?: (() => void) | undefined; href?: never };

/** An icon-only control of a {@link DetailBar}, named by its tooltip, which also shows the key that does the same. */
function BarButton({ action }: { action: BarAction }) {
	const disabled = "onClick" in action && action.onClick === undefined;
	const button = (
		<Button
			variant="ghost"
			size="icon-compact"
			aria-label={action.label}
			disabled={disabled}
			onClick={action.onClick}
			render={"href" in action && action.href ? <a href={action.href} /> : undefined}
		>
			{action.icon}
		</Button>
	);
	return <Tooltip content={action.label} shortcut={action.shortcut && shortcutLabels(action.shortcut)} disabled={disabled}>{button}</Tooltip>;
}

/** The narrow bar of a split's open item: a `leading` slot, the previous and next controls, optional `children`, and the close control. */
export function DetailBar({ leading, previous, next, children, close }: { leading?: ReactNode; previous: BarAction; next: BarAction; children?: ReactNode; close: BarAction }) {
	return (
		<div className="sticky top-0 z-10 flex h-11 items-center gap-1 border-b border-border bg-background/95 px-4 backdrop-blur">
			{leading !== undefined && <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{leading}</div>}
			{leading === undefined && <div className="flex-1" />}
			<BarButton action={previous} />
			<BarButton action={next} />
			{children}
			<BarButton action={close} />
		</div>
	);
}

/** Chevron icons for {@link DetailBar} `previous` and `next`; the inbox and the todo use them. */
export const CH_PREVIOUS: BarAction["icon"] = <ChevronUp />;
export const CH_NEXT: BarAction["icon"] = <ChevronDown />;
export const CH_CLOSE: BarAction["icon"] = <X />;

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
	detail: ReactElement | null;
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
	const aside = useRef<HTMLElement>(null);
	// A new open item (or its absence) restarts the detail's scroll, so it opens at the top.
	useLayoutEffect(() => {
		if (detail) aside.current?.scrollTo({ top: 0 });
	}, [detail?.key]);
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
			<aside ref={aside} aria-label={detailLabel} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto @3xl/split:block @3xl/split:border-l @3xl/split:border-border", !open && "hidden")}>
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
