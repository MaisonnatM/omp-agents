import { ListTodo } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useStoredState } from "../../stored-state";
import { Separator, useDragSeparator } from "../drag-separator";

const WIDTH_KEY = "omp-agents.todo-list-width";
const DEFAULT_WIDTH = 440;
const MIN_LIST = 300;
const MAX_LIST = 720;
/** Narrowest the open todo gets beside the list: a narrower page takes the width from the list. */
const MIN_DETAIL = 352;
const STEP = 16;

const clampWidth = (width: number, size: number): number => Math.round(Math.max(MIN_LIST, Math.min(MAX_LIST, size - MIN_DETAIL, width)));

interface TodoSplitProps {
	list: ReactNode;
	/** The open todo, `null` with none open. */
	detail: ReactNode | null;
}

/**
 * The list on the left and the open todo on the right, as in Linear, split by a line you drag to size the list.
 * A page too narrow for both shows the list, or the open todo in its place.
 */
export function TodoSplit({ list, detail }: TodoSplitProps) {
	const [width, setWidth] = useStoredState(WIDTH_KEY, raw => {
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
	// `100%` resolves where the variable is used, against the split's width, so a stored width never squeezes the open todo.
	const style = { "--todo-list": `min(${width}px, calc(100% - ${MIN_DETAIL}px))` } as CSSProperties;
	return (
		<div style={style} className="@container/todo relative flex h-full min-h-0">
			<div className={cn("min-h-0 w-full overflow-y-auto @3xl/todo:block @3xl/todo:w-(--todo-list) @3xl/todo:shrink-0", open && "hidden")}>{list}</div>
			<Separator
				{...events}
				axis="vertical"
				label="Resize the todo list"
				min={MIN_LIST}
				max={MAX_LIST}
				now={width}
				style={{ left: "var(--todo-list)" }}
				className="inset-y-0 hidden w-3 -translate-x-1/2 cursor-col-resize select-none @3xl/todo:flex"
			/>
			<aside aria-label="Open todo" className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto @3xl/todo:block @3xl/todo:border-l @3xl/todo:border-border", !open && "hidden")}>
				{detail ?? (
					<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
						<ListTodo aria-hidden className="size-6 text-muted-foreground/60" />
						<p>No todo open</p>
						<p className="text-xs text-muted-foreground/80">Click a todo, or focus one with J and K and press Enter.</p>
					</div>
				)}
			</aside>
		</div>
	);
}
