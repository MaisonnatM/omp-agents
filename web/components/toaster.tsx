/** The page's toasts: the `toasts` queue that shows one from anywhere, `loadingToast` for work that takes a while, `offerUndo` after a delete or a move, and `Toaster`, which stacks them bottom right. */
import { IconCrossMedium } from "central-icons";
import { createToaster, Toast, ToastAction, ToastClose, type ToastData as QueuedToast, ToastDescription, ToastRegion, ToastTitle } from "@ui-sdk/react/toast";
import { type CSSProperties, type ReactNode, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useRegionHeight } from "@/hooks/use-region-height";
import { useSecond } from "../use-minute";
import { usePhoneWidth } from "../use-phone-width";
import { Spinner } from "./spinner";

/**
 * What a toast carries beyond its text, as its `data`: `source`, the line over its title that says where it came from,
 * such as Slack's logo and name, `startedAt`, when a loading toast opened, in ms since the epoch, and `actionDisabled`,
 * whether its action is off for now.
 */
export interface ToastData {
	source?: ReactNode;
	startedAt?: number;
	actionDisabled?: boolean;
}

/** The page's toasts: `toasts(…)` shows one from anywhere, without rendering its caller again as the toasts change. */
export const toasts = createToaster<ReactNode>();

/** What a toast says. */
export interface ToastText {
	title: string;
	description?: string;
}

/**
 * Shows `text` with a spinner and the time since it opened, and returns its id. It never times out and has no
 * close button: `toasts.update` changes its text as the work goes on, and {@link settleToast} turns it into how it ended.
 */
export const loadingToast = (text: ToastText): string => toasts.loading({ ...text, data: { startedAt: Date.now() } satisfies ToastData });

/**
 * Turns the loading toast `id` into `text`, which then closes after the page's usual five seconds. Adding by id updates
 * the toast in place, and shows it again when it was swiped away meanwhile, so how the work ended always shows. The
 * update merges into what the toast said, so it names `description` even when `text` has none, to clear the old one.
 */
export function settleToast(id: string, text: ToastText): void {
	toasts({ id, type: "default", title: text.title, description: text.description });
}

/** How long **Undo** stays after a delete or a move. */
const UNDO_MS = 8000;

/**
 * Shows `title` as toast `id` with **Undo**, which closes it and runs `undo`, for {@link UNDO_MS}. A later one with the same
 * `id` takes its place, and one `undo` shows itself, as a move back does, stays open.
 */
export function offerUndo(id: string, title: string, undo: () => void): void {
	toasts({
		id,
		title,
		duration: UNDO_MS,
		action: {
			label: "Undo",
			dismiss: false,
			onAction: () => {
				toasts.dismiss(id);
				undo();
			},
		},
	});
}

/** The element under the toasts that {@link UnderToasts} draws into, once `Toaster` has mounted it. */
let corner: HTMLElement | null = null;
const cornerListeners = new Set<() => void>();

function setCorner(element: HTMLElement | null): void {
	corner = element;
	for (const listener of cornerListeners) listener();
}

function subscribeCorner(listener: () => void): () => void {
	cornerListeners.add(listener);
	return () => cornerListeners.delete(listener);
}

/** Draws `children` in the bottom-right corner under the toasts, so a toast stacks above it instead of covering it. */
export function UnderToasts({ children }: { children: ReactNode }) {
	const element = useSyncExternalStore(subscribeCorner, () => corner);
	return element && createPortal(children, element);
}

/** The room `height` takes in the stack of toasts and what sits under them, with the gap after it when there is any. */
const stackRoom = (height: number | null): string => (height ? `${height + 8}px` : "0px");

/**
 * Every toast of the page, stacked at the bottom right, the newest last, each under its source when it has one; on a
 * phone, where a second toast would bury the page, only the newest, at the top, clear of the composer, and the next
 * one waits under it. A toast that never times out gets a round close button on its corner, shown on hover or focus,
 * and always on a touch screen. What {@link UnderToasts} draws sits below them, outside their region, which renders in
 * the top layer: each measures the other to keep clear of it.
 */
export function Toaster() {
	const phone = usePhoneWidth();
	const [regionRef, regionHeight] = useRegionHeight();
	const [cornerRef, cornerHeight] = useRegionHeight();
	const placeCorner = useCallback(
		(element: HTMLElement | null) => {
			setCorner(element);
			cornerRef(element);
		},
		[cornerRef],
	);
	return (
		<>
			<ToastRegion
				ref={regionRef}
				toaster={toasts}
				side={phone ? "top" : "bottom"}
				align="end"
				maxVisible={phone ? 1 : undefined}
				style={{ "--under-toasts": stackRoom(cornerHeight) } as CSSProperties}
				className="right-4 bottom-[calc(2.5rem+var(--under-toasts))] w-96 max-w-[calc(100vw-2rem)] *:flex *:flex-col-reverse *:gap-2 max-phone:top-[max(calc(var(--page-header-height)+0.5rem),calc(env(safe-area-inset-top)+2.75rem))] max-phone:right-2 max-phone:bottom-auto max-phone:max-w-[calc(100vw-1rem)]"
			>
				{toast => <ToastCard toast={toast} />}
			</ToastRegion>
			<div
				ref={placeCorner}
				style={{ "--over-corner": stackRoom(regionHeight) } as CSSProperties}
				className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col items-end gap-2 *:pointer-events-auto max-phone:top-[calc(max(calc(var(--page-header-height)+0.5rem),calc(env(safe-area-inset-top)+2.75rem))+var(--over-corner))] max-phone:right-2 max-phone:bottom-auto max-phone:max-w-[calc(100vw-1rem)]"
			/>
		</>
	);
}

/** `0:42`, `12:05`: minutes, then seconds. */
export const clockWords = (ms: number): string => {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The time since `since`, renewed each second; hidden from screen readers, which would otherwise read the toast again each second. */
function Elapsed({ since }: { since: number }) {
	const now = useSecond();
	return <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">{clockWords(now - since)}</span>;
}

/** One toast; on a phone, where they sit at the top, a swipe up or right puts it away, and it follows the finger. */
function ToastCard({ toast }: { toast: QueuedToast<ReactNode> }) {
	const data = toast.data as ToastData | undefined;
	const loading = toast.type === "loading";
	const startedAt = loading ? data?.startedAt : undefined;
	return (
		<Toast className="group/toast relative rounded-[10px] bg-popover text-[13px]/5 text-popover-foreground shadow-surface-6 max-phone:translate-x-[var(--toast-swipe-x,0px)] max-phone:translate-y-[var(--toast-swipe-y,0px)]">
			<div className="flex items-start gap-2 p-3 max-phone:flex-wrap max-phone:gap-y-1">
				<div className="flex min-w-0 flex-1 flex-col max-phone:basis-full">
					{data?.source && <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{data.source}</div>}
					<div className="flex min-w-0 items-center gap-2">
						{loading && <Spinner className="size-4 text-muted-foreground" />}
						<ToastTitle className="min-w-0 flex-1 truncate font-medium" />
						{startedAt !== undefined && <Elapsed since={startedAt} />}
					</div>
					<ToastDescription className="text-muted-foreground" />
				</div>
				<div className="contents max-phone:ms-auto max-phone:flex max-phone:gap-2">
					<ToastAction disabled={data?.actionDisabled} render={<Button variant="secondary" size="compact" className="self-center" />} />
				</div>
			</div>
			{toast.duration === Infinity && !loading && (
				<ToastClose
					aria-label="Dismiss"
					className="absolute -top-[7px] -left-[7px] flex size-6 scale-85 cursor-pointer items-center justify-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-surface-2 transition-[opacity,scale] duration-150 ease-out outline-ring group-hover/toast:scale-100 group-hover/toast:opacity-100 group-focus-within/toast:scale-100 group-focus-within/toast:opacity-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none pointer-coarse:-top-2 pointer-coarse:-left-2 pointer-coarse:size-8 pointer-coarse:scale-100 pointer-coarse:opacity-100"
				>
					<IconCrossMedium aria-hidden className="size-3.5" />
				</ToastClose>
			)}
		</Toast>
	);
}
