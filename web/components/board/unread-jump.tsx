/**
 * Slack's pills for unread messages you cannot see, on the Board: at the channel's top or bottom edge while threads with
 * unread replies sit out of view there, and at the thread's foot while replies that came as you read further up wait
 * below. Each scrolls to the nearest and flashes it; each stands in for the scroller's own scroll-to-end arrow.
 */
import { IconArrowDown, IconArrowUp } from "central-icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { BoardTask } from "../../../templates/omp/agent/extensions/board/log";
import { Button } from "@/components/ui/button";
import { MessageScrollerButton, useMessageScroller, useMessageScrollerScrollable } from "@/components/ui/message-scroller";
import { activityControl } from "../../activity";
import { markSeen, said, unreadOf, unreadOutOfView, useSeen } from "./seen";

/** The scroller item id of Board task `id` in the channel. */
export const taskItemId = (id: number): string => `task-${id}`;

/** Scrolls to scroller item `itemId` and flashes its row light blue, as Slack flashes the message it jumps to. */
function useJump(): (itemId: string, align: "center" | "start") => void {
	const { scrollToMessage } = useMessageScroller();
	return (itemId, align) => {
		scrollToMessage(itemId, { align, behavior: "smooth" });
		document.querySelector(`[data-message-id="${itemId}"] > *`)?.animate([{ backgroundColor: "oklch(0.746 0.16 232.661 / 0.35)" }], { duration: 1600, easing: "ease-out" });
	};
}

/**
 * The `data-message-id`s of the scroller items showing in the viewport beside the returned anchor, kept current as it
 * scrolls or its content grows. The primitive's own visibility list sees only its content's direct children, and the
 * Board's items sit in list rows.
 */
function useShownItems() {
	const anchor = useRef<HTMLSpanElement>(null);
	const [shown, setShown] = useState<readonly string[]>([]);
	useEffect(() => {
		const viewport = anchor.current?.parentElement?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');
		if (!viewport) return;
		const measure = () => {
			const box = viewport.getBoundingClientRect();
			const ids = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")].flatMap(item => {
				const rect = item.getBoundingClientRect();
				return rect.bottom > box.top && rect.top < box.bottom ? [item.dataset.messageId!] : [];
			});
			setShown(previous => (previous.length === ids.length && previous.every((id, index) => id === ids[index]) ? previous : ids));
		};
		measure();
		viewport.addEventListener("scroll", measure, { passive: true });
		const resized = new ResizeObserver(measure);
		resized.observe(viewport);
		if (viewport.firstElementChild) resized.observe(viewport.firstElementChild);
		return () => {
			viewport.removeEventListener("scroll", measure);
			resized.disconnect();
		};
	}, []);
	return { anchor: <span ref={anchor} hidden />, shown };
}

/** A solid blue pill floating at the scroller's top or bottom edge, centred, as Slack's new messages bar and the scroll-to-end arrow do. */
function Pill({ edge, children }: { edge: "top" | "bottom"; children: ReactNode }) {
	return <div className={`absolute start-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-sky-600 p-0.5 text-white shadow-md rtl:translate-x-1/2 dark:bg-sky-500 ${edge === "top" ? "top-4" : "bottom-4"}`}>{children}</div>;
}

const ON_BLUE = "rounded-full px-3 hover:bg-white/15 hover:text-white active:bg-white/25";

/** The channel's pills: `↑ N unread threads` while unread ones sit above what shows, `↓` below, each with **Mark all read**; the open thread's task counts as read. */
export function ChannelUnreadPills({ tasks, open }: { tasks: readonly BoardTask[]; open: number | null }) {
	const seen = useSeen();
	const { anchor, shown } = useShownItems();
	const jump = useJump();
	const unreadTasks = tasks.filter(task => task.id !== open && unreadOf(task, seen[task.id]) > 0);
	const visible = new Set(shown.flatMap(id => (id.startsWith("task-") ? [Number(id.slice(5))] : [])));
	const { above, below } = unreadOutOfView(
		tasks.map(task => task.id),
		new Set(unreadTasks.map(task => task.id)),
		visible,
	);
	const markAllRead = () => {
		for (const task of unreadTasks) markSeen(task.id, said(task).length);
	};
	const pill = (edge: "top" | "bottom", ids: number[]) => (
		<Pill edge={edge}>
			<Button {...activityControl("board.unread.jump")} variant="ghost" size="compact" className={`font-medium text-white ${ON_BLUE}`} leadingIcon={edge === "top" ? IconArrowUp : IconArrowDown} onClick={() => jump(taskItemId(ids[0]!), "center")}>
				{ids.length} unread {ids.length === 1 ? "thread" : "threads"}
			</Button>
			<span aria-hidden className="h-4 w-px bg-white/30" />
			<Button {...activityControl("board.unread.read-all")} variant="ghost" size="compact" className={`text-white/85 ${ON_BLUE}`} onClick={markAllRead}>
				Mark all read
			</Button>
		</Pill>
	);
	return (
		<>
			{anchor}
			{above.length > 0 && pill("top", above)}
			{below.length > 0 ? pill("bottom", below) : <MessageScrollerButton />}
		</>
	);
}

/** The thread's `↓ N new replies` pill: the replies others wrote while you read further up, until one of them shows or you reach the end. */
export function ThreadNewReplies({ task }: { task: BoardTask }) {
	const { end: scrolledUp } = useMessageScrollerScrollable();
	const { anchor, shown: showing } = useShownItems();
	const jump = useJump();
	const length = task.replies.length;
	const [known, setKnown] = useState(length);
	// The first new reply's index in `task.replies`, set when replies come while the thread is scrolled up; measured before they show, so the end the scroller follows does not count.
	const [from, setFrom] = useState<number | null>(null);
	if (known !== length) {
		setKnown(length);
		if (length > known && scrolledUp && from === null) setFrom(known);
	}
	const fresh = from === null ? [] : task.replies.flatMap((entry, index) => (index >= from && "by" in entry && entry.by.kind !== "user" ? [`reply-${index}`] : []));
	const shown = fresh.some(id => showing.includes(id));
	useEffect(() => {
		if (from !== null && (!scrolledUp || shown)) setFrom(null);
	}, [from, scrolledUp, shown]);
	return (
		<>
			{anchor}
			{fresh.length === 0 || shown ? (
				<MessageScrollerButton />
			) : (
				<Pill edge="bottom">
					<Button {...activityControl("board.thread.new-replies")} variant="ghost" size="compact" className={`font-medium text-white ${ON_BLUE}`} leadingIcon={IconArrowDown} onClick={() => jump(fresh[0]!, "start")}>
						{fresh.length} new {fresh.length === 1 ? "reply" : "replies"}
					</Button>
				</Pill>
			)}
		</>
	);
}
