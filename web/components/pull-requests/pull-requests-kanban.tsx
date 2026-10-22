/**
 * The Pull requests board: a column per section, whose cards a drag or the keys drop on another column to run the step
 * that moves them there, or are refused with why.
 */
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type PullRequest, prKey, pullRequestName } from "../../../src/shared/github";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { type BoardDrop, boardDrop, type ListChange, type MoveGroup, reason } from "../../pull-requests-model";
import { useShortcuts } from "../../shortcuts";
import { useAction } from "../../use-action";
import { FoldButton } from "../fold";
import type { ColumnView } from "./pull-requests-board";
import { CARD_KEY, type CardProps, MoveBadge, PullRequestCard, rowElement, rowLink } from "./pr-row";

type Card = ColumnView["cards"][number];

/** A card in hand: the pointer's, which carries it, or the keys', which pick its column with ← and →. */
interface Hold {
	card: Card;
	from: MoveGroup;
	over: MoveGroup;
	by: "pointer" | "keys";
	/** The card's size, which the card in the pointer's hand and the slot it lands in take. */
	width: number;
	height: number;
}

/** The DOM attributes the drag reads under the pointer: a column by its title, and the slot a card lands in. */
const COLUMN_KEY = "data-board-column";
const SLOT_KEY = "data-board-slot";

/** How far the pointer moves before a press becomes a drag, so a click still opens the card. */
const LIFT_DISTANCE = 4;

/** How close to the board's left or right edge the pointer scrolls it, and by how much a frame. */
const EDGE = 64;
const EDGE_STEP = 14;

const SETTLE = { type: "spring", stiffness: 700, damping: 42 } as const;

/** What a drop would do, as the slot, the card in hand, and the announcement say it. */
const dropText = (drop: BoardDrop): string => (drop.kind === "refused" ? drop.why : drop.label);

/** Swallows the click that ends a drag, so dropping a card does not open it too. */
function swallowNextClick(): void {
	const swallow = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};
	window.addEventListener("click", swallow, { capture: true, once: true });
	setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/** The column under the point, by its title; `null` outside every column. */
function columnAt(x: number, y: number): MoveGroup | null {
	const column = document.elementFromPoint(x, y)?.closest(`[${COLUMN_KEY}]`);
	return (column?.getAttribute(COLUMN_KEY) as MoveGroup | undefined) ?? null;
}

/** The card the pointer carries: its badge, number, title, and reason, under what dropping it here would do. */
function CardInHand({ card, drop }: { card: Card; drop: BoardDrop | null }) {
	const { pr, move } = card.row;
	return (
		<div className="space-y-1.5 rounded-lg border border-border bg-background p-2.5 shadow-lg/15">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<MoveBadge move={move} />
				<span className="ml-auto tabular-nums">{card.repo ? `${card.repo}#${pr.number}` : `#${pr.number}`}</span>
			</div>
			<p className="line-clamp-2 text-sm font-medium leading-5">{pr.title}</p>
			<p className="truncate text-xs text-muted-foreground">{reason(pr, move)}</p>
			{drop && (
				<p className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium text-pretty", drop.kind === "refused" ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-primary/10 text-primary")}>
					{dropText(drop)}
				</p>
			)}
		</div>
	);
}

interface ColumnProps {
	column: ColumnView;
	hold: Hold | null;
	/** What dropping the card in hand on this column does; `null` when nothing is in hand, or it came from here. */
	drop: BoardDrop | null;
	moving: string | null;
}

/**
 * An open column with cards: its title and count, which fold it, then the slot a card in hand would land in, or why it
 * cannot, then its cards. A folded or empty column is a narrow strip that still takes a drop.
 */
function Column({ column: { title, listId, open, toggle, cards }, hold, drop, moving }: ColumnProps) {
	const lands = drop !== null && drop.kind !== "refused";
	const look = cn("shrink-0 rounded-xl transition-colors", lands && "bg-primary/5 ring-1 ring-primary/40", drop?.kind === "refused" && "bg-red-500/5 ring-1 ring-red-500/40");
	if (!open || cards.length === 0) {
		return (
			<section {...{ [COLUMN_KEY]: title }} aria-label={title} className={cn(look, "flex min-h-48 w-10 flex-col items-center self-stretch py-2", !drop && "bg-muted/30")}>
				<button
					type="button"
					aria-expanded={false}
					aria-label={cards.length === 0 ? `${title}: none` : `Unfold ${title}, ${cards.length}`}
					disabled={cards.length === 0}
					onClick={toggle}
					className="sticky top-2 flex flex-col items-center gap-2 rounded px-1 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:text-muted-foreground"
				>
					{cards.length > 0 && <ChevronRight aria-hidden className="size-3.5" />}
					<span className="tabular-nums">{cards.length}</span>
					<span className={cn("font-medium [writing-mode:vertical-rl]", lands && "text-primary", drop?.kind === "refused" && "text-red-600 dark:text-red-400")}>{drop ? dropText(drop) : title}</span>
				</button>
			</section>
		);
	}
	const heldKey = hold && prKey(hold.card.row.pr);
	return (
		<section {...{ [COLUMN_KEY]: title }} aria-labelledby={`${listId}-title`} className={cn(look, "flex w-72 flex-col gap-2 p-2", !drop && "bg-muted/40")}>
			<h2 id={`${listId}-title`} className="flex items-center px-1 pt-0.5 text-sm font-medium">
				<FoldButton open onToggle={toggle} controls={listId}>
					{title}
					<span className="text-xs tabular-nums text-muted-foreground">{cards.length}</span>
				</FoldButton>
			</h2>
			<AnimatePresence initial={false}>
				{lands && (
					<motion.div
						key="slot"
						{...{ [SLOT_KEY]: "" }}
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: hold?.height ?? 56, opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={spring.moderate}
						className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-primary/50 text-xs font-medium text-primary"
					>
						{drop.label}
					</motion.div>
				)}
			</AnimatePresence>
			{drop?.kind === "refused" && <p className="px-1 text-xs text-red-600 dark:text-red-400">{drop.why}</p>}
			<ul id={listId} aria-label={title} className="flex flex-col gap-2">
				{cards.map(card => {
					const key = prKey(card.row.pr);
					const held: CardProps["held"] = key === heldKey ? (hold!.by === "pointer" ? "lifted" : "picked") : key === moving ? "moving" : null;
					return <PullRequestCard key={key} {...card} held={held} />;
				})}
			</ul>
		</section>
	);
}

/**
 * The board of `columns`. A card dragged past a few pixels lifts and tilts with its speed; the column under it shows the
 * slot it would land in, labeled with what the drop does, or turns red with why it cannot. Releasing settles the card
 * into the slot and runs the drop, or springs it back; Esc puts it back. Space on a focused card picks it up for the
 * keys, and a live region says each step.
 */
export function PullRequestsKanban({ columns }: { columns: ColumnView[] }) {
	const reduced = useReducedMotion();
	const scroller = useRef<HTMLDivElement>(null);
	const [hold, setHold] = useState<Hold | null>(null);
	const holding = useRef(false);
	holding.current = hold !== null;
	const [moving, setMoving] = useState<string | null>(null);
	const [said, say] = useState("");
	/** The pull request whose card the keys dropped, whose link takes focus back once the card shows in its new column. */
	const refocus = useRef<PullRequest | null>(null);
	const x = useMotionValue(0);
	const y = useMotionValue(0);
	const rotate = useSpring(useTransform(useVelocity(x), [-1600, 0, 1600], [-7, 0, 7], { clamp: true }), { stiffness: 500, damping: 32 });

	const change = useAction(async (card: Card, next: ListChange) => {
		const key = prKey(card.row.pr);
		setMoving(key);
		try {
			await card.onChange(card.row.pr, next);
		} finally {
			setMoving(current => (current === key ? null : current));
		}
	}, "GitHub refused the change");

	const find = (key: string): { card: Card; from: MoveGroup } | null => {
		for (const { title, cards } of columns) for (const card of cards) if (prKey(card.row.pr) === key) return { card, from: title };
		return null;
	};

	/** Lets go of `held` over its column: runs the drop there, or says why it cannot or that the card stayed. */
	const release = (held: Hold): void => {
		const { pr } = held.card.row;
		const drop = boardDrop(held.card.row, held.from, held.over);
		setHold(null);
		if (drop === null) return say(`${pullRequestName(pr)} stays in ${held.from}`);
		if (drop.kind === "refused") return say(`${pullRequestName(pr)} cannot move to ${held.over}: ${drop.why}`);
		say(`${drop.label}: ${pullRequestName(pr)}`);
		if (held.by === "keys") refocus.current = pr;
		if (drop.kind === "agent") held.card.onQuickAction(pr, held.card.cwd, drop.action);
		else if (drop.kind === "merge") held.card.onMergeOpenChange(pr, true);
		else change.run(held.card, { field: "state", state: drop.state });
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (event.button !== 0 || event.pointerType === "touch" || holding.current) return;
		const target = event.target as Element;
		if (target.closest("button, input, textarea, [role=menuitem]")) return;
		const element = target.closest<HTMLElement>(`[${CARD_KEY}]`);
		const found = element && find(element.getAttribute(CARD_KEY)!);
		if (!element || !found) return;
		const start = { x: event.clientX, y: event.clientY };
		const box = element.getBoundingClientRect();
		const held: Hold = { ...found, over: found.from, by: "pointer", width: box.width, height: box.height };
		let lifted = false;
		let pointer = start;
		let frame = 0;
		const retarget = (): void => {
			const over = columnAt(pointer.x, pointer.y) ?? held.from;
			if (over === held.over) return;
			held.over = over;
			setHold({ ...held });
		};
		const edgeScroll = (): void => {
			const board = scroller.current;
			if (board) {
				const { left, right } = board.getBoundingClientRect();
				const by = pointer.x < left + EDGE ? -EDGE_STEP : pointer.x > right - EDGE ? EDGE_STEP : 0;
				if (by !== 0 && board.scrollWidth > board.clientWidth) {
					board.scrollLeft += by;
					retarget();
				}
			}
			frame = requestAnimationFrame(edgeScroll);
		};
		const stop = (): void => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", escape, true);
			cancelAnimationFrame(frame);
			document.body.style.removeProperty("cursor");
		};
		/** Springs the card in hand onto `into`, then lets go of it. */
		const settle = async (into: Element | null): Promise<void> => {
			if (into && !reduced) {
				const { left, top } = into.getBoundingClientRect();
				await Promise.all([animate(x, left, SETTLE), animate(y, top, SETTLE)]);
			}
			release(held);
		};
		const landing = (): Element | null => {
			const drop = boardDrop(held.card.row, held.from, held.over);
			if (drop === null || drop.kind === "refused") return rowElement(held.card.row.pr);
			const column = document.querySelector(`[${COLUMN_KEY}="${held.over}"]`);
			return column?.querySelector(`[${SLOT_KEY}]`) ?? column;
		};
		function move(next: PointerEvent): void {
			pointer = { x: next.clientX, y: next.clientY };
			if (!lifted) {
				if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < LIFT_DISTANCE) return;
				lifted = true;
				window.getSelection()?.removeAllRanges();
				document.body.style.cursor = "grabbing";
				setHold({ ...held });
				frame = requestAnimationFrame(edgeScroll);
			}
			x.set(box.left + pointer.x - start.x);
			y.set(box.top + pointer.y - start.y);
			retarget();
		}
		function up(): void {
			stop();
			if (!lifted) return;
			swallowNextClick();
			void settle(landing());
		}
		function cancel(): void {
			stop();
			if (!lifted) return;
			held.over = held.from;
			void settle(rowElement(held.card.row.pr));
		}
		function escape(key: KeyboardEvent): void {
			if (key.key !== "Escape" || !lifted) return;
			key.preventDefault();
			key.stopPropagation();
			cancel();
		}
		x.jump(box.left);
		y.jump(box.top);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", escape, true);
	};

	useShortcuts({
		liftPullRequest: () => {
			const active = document.activeElement;
			const element = active instanceof HTMLAnchorElement ? active.closest<HTMLElement>(`[${CARD_KEY}]`) : null;
			const found = !holding.current && element && find(element.getAttribute(CARD_KEY)!);
			if (!element || !found) return false;
			setHold({ ...found, over: found.from, by: "keys", width: element.offsetWidth, height: element.offsetHeight });
			say(`Picked up ${pullRequestName(found.card.row.pr)} in ${found.from}. Left and right choose a column, Space or Enter drops it, Escape puts it back.`);
		},
	});

	useEffect(() => {
		if (hold?.by !== "keys") return;
		const titles = columns.map(({ title }) => title);
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				const over = titles[titles.indexOf(hold.over) + (event.key === "ArrowLeft" ? -1 : 1)];
				if (over) {
					setHold({ ...hold, over });
					const drop = boardDrop(hold.card.row, hold.from, over);
					say(`${over}: ${drop ? dropText(drop) : "where it is now"}`);
					document.querySelector(`[${COLUMN_KEY}="${over}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
				}
			} else if (event.key === " " || event.key === "Enter") {
				release(hold);
			} else if (event.key === "Escape" || event.key === "Tab") {
				setHold(null);
				say(`${pullRequestName(hold.card.row.pr)} put back in ${hold.from}`);
				if (event.key === "Tab") return;
			} else return;
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	useEffect(() => {
		const pr = refocus.current;
		if (!pr || document.activeElement !== document.body) return;
		const link = rowLink(pr);
		if (!link) return;
		link.focus({ preventScroll: true });
		link.scrollIntoView({ block: "nearest", inline: "nearest" });
		refocus.current = null;
	}, [columns]);

	const dropOn = (title: MoveGroup): BoardDrop | null => (hold && hold.over === title ? boardDrop(hold.card.row, hold.from, title) : null);
	const inHand = hold?.by === "pointer" ? dropOn(hold.over) : null;
	return (
		<>
			<p role="status" aria-live="assertive" className="sr-only">
				{said}
			</p>
			<div ref={scroller} onPointerDown={onPointerDown} className="-mx-6 flex min-h-0 items-start gap-3 overflow-x-auto px-6 pt-1 pb-6">
				{columns.map(column => (
					<Column key={column.title} column={column} hold={hold} drop={dropOn(column.title)} moving={moving} />
				))}
			</div>
			{hold?.by === "pointer" &&
				createPortal(
					<motion.div aria-hidden style={{ x, y, rotate, width: hold.width }} className="pointer-events-none fixed top-0 left-0 z-50 cursor-grabbing">
						<CardInHand card={hold.card} drop={inHand} />
					</motion.div>,
					document.body,
				)}
		</>
	);
}
