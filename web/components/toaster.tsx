/** The page's toasts: the `toasts` manager that shows one from anywhere, `loadingToast` for work that takes a while, and `Toaster`, which stacks them bottom right. */
import { Toast } from "@base-ui/react/toast";
import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useSecond } from "../use-minute";
import { usePhoneWidth } from "../use-phone-width";
import { Spinner } from "./spinner";

/**
 * What a toast carries beyond its text: `source`, the line over its title that says where it came from, such as Slack's
 * logo and name, and `startedAt`, when a loading toast opened, in ms since the epoch.
 */
export interface ToastData {
	source?: ReactNode;
	startedAt?: number;
}

/** The page's toasts: `toasts.add` shows one from anywhere, without rendering its caller again as the toasts change. */
export const toasts = Toast.createToastManager<ToastData>();

/** What a toast says. */
export interface ToastText {
	title: string;
	description?: string;
}

/**
 * Shows `text` with a spinner and the time since it opened, and returns its id. It never times out and has no
 * **Dismiss**: `toasts.update` changes its text as the work goes on, and {@link settleToast} turns it into how it ended.
 */
export const loadingToast = (text: ToastText): string => toasts.add({ ...text, type: "loading", data: { startedAt: Date.now() } });

/**
 * Turns the loading toast `id` into `text`, which then closes after the page's usual five seconds. Adding by id updates
 * the toast in place, and shows it again when it was swiped away meanwhile, so how the work ended always shows. The
 * update merges into what the toast said, so it names `description` even when `text` has none, to clear the old one.
 */
export function settleToast(id: string, text: ToastText): void {
	toasts.add({ id, type: undefined, title: text.title, description: text.description });
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

/**
 * Every toast of the page, stacked at the bottom right, the newest last, each under its source when it has one; on a
 * phone, where a second toast would bury the page, only the newest, at the top, clear of the composer, and the next
 * one waits under it. A toast that never times out gets **Dismiss**. What {@link UnderToasts} draws sits below them,
 * outside their live region.
 */
export function Toaster() {
	const phone = usePhoneWidth();
	return (
		<Toast.Provider toastManager={toasts} limit={phone ? 1 : undefined}>
			<Toast.Portal>
				<div className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col items-end gap-2 *:pointer-events-auto max-phone:top-[max(calc(var(--page-header-height)+0.5rem),calc(env(safe-area-inset-top)+2.75rem))] max-phone:right-2 max-phone:bottom-auto max-phone:max-w-[calc(100vw-1rem)]">
					<Toast.Viewport className="flex w-full flex-col-reverse gap-2">
						<ToastList />
					</Toast.Viewport>
					<div ref={setCorner} className="contents" />
				</div>
			</Toast.Portal>
		</Toast.Provider>
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

/** Each toast; on a phone, where they sit at the top, a swipe up or right puts one away, and it follows the finger. */
function ToastList() {
	const phone = usePhoneWidth();
	return Toast.useToastManager<ToastData>().toasts.map(toast => {
		const loading = toast.type === "loading";
		const startedAt = loading ? toast.data?.startedAt : undefined;
		return (
			<Toast.Root
				key={toast.id}
				toast={toast}
				swipeDirection={phone ? ["up", "right"] : undefined}
				className="rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-lg data-limited:hidden max-phone:translate-x-(--toast-swipe-movement-x) max-phone:translate-y-(--toast-swipe-movement-y)"
			>
				<Toast.Content className="flex items-center gap-3 max-phone:flex-wrap max-phone:gap-y-1">
					<div className="flex min-w-0 flex-1 flex-col max-phone:basis-full">
						{toast.data?.source && <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{toast.data.source}</div>}
						<div className="flex min-w-0 items-center gap-2">
							{loading && <Spinner className="size-4" />}
							<Toast.Title className="min-w-0 flex-1 truncate" />
							{startedAt !== undefined && <Elapsed since={startedAt} />}
						</div>
						<Toast.Description className="text-muted-foreground" />
					</div>
					<div className="contents max-phone:ms-auto max-phone:flex max-phone:gap-2">
						<Toast.Action render={<Button variant="secondary" size="compact" />} />
						{toast.timeout === 0 && <Toast.Close render={<Button variant="ghost" size="compact" />}>Dismiss</Toast.Close>}
					</div>
				</Toast.Content>
			</Toast.Root>
		);
	});
}
