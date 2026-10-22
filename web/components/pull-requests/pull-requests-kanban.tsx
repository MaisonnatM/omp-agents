/**
 * The Pull requests board: a column per section, whose cards a drag or the keys drop on another column to run the step
 * that moves them there, or are refused with why.
 */
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type PullRequest, prKey, pullRequestName, samePullRequest } from "../../../src/shared/github";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { type BoardCard, type BoardColumn, type BoardDrop, boardColumns, boardDrop, boardFoldedByDefault, type ListChange, type MoveGroup, reason, shownBoardPullRequests } from "../../pull-requests-model";
import { type SectionTarget, sectionId } from "../../section";
import { useShortcuts } from "../../shortcuts";
import { useAction } from "../../use-action";
import { usePointerDrag } from "../../use-pointer-drag";
import { type Folds, FoldButton, useFolds, useReveal } from "../fold";
import { type PullRequests, usePullRequestKeys } from "./pull-requests-board";
import { CARD_KEY, type CardProps, MoveBadge, PullRequestCard, rowElement, rowId, rowLink } from "./pr-row";

/** The board's columns flipped from their default fold, by section title. */
const BOARD_FOLDS_KEY = "omp-agents.pull-requests-board-folds";

/** A card in hand: the pointer's, which carries it, or the keys', which pick its column with ← and →. */
interface Hold {
	card: BoardCard;
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

const SETTLE = { type: "spring", stiffness: 700, damping: 42 } as const;

/** The board's column `title`, which a sidebar link unfolds, scrolls to, and focuses. */
export const boardColumnTarget = (title: MoveGroup): SectionTarget => ({ id: sectionId("pull-requests-column", title), folds: [title] });

/** What a drop would do, as the slot, the card in hand, and the announcement say it. */
const dropText = (drop: BoardDrop): string => (drop.kind === "refused" ? drop.why : drop.label);

/** The column under the point, by its title; `null` outside every column. */
function columnAt(x: number, y: number): MoveGroup | null {
	const column = document.elementFromPoint(x, y)?.closest(`[${COLUMN_KEY}]`);
	return (column?.getAttribute(COLUMN_KEY) as MoveGroup | undefined) ?? null;
}

/**
 * The board's columns of `pulls` and their folds, which the browser keeps, with the keys over the cards they show. The
 * column holding the pull request the main area shows unfolds and scrolls its card into view.
 */
function usePullRequestsColumns(pulls: PullRequests): { columns: BoardColumn[]; folds: Folds } {
	const { list, order, agent, route: { target } } = pulls;
	const folds = useFolds(BOARD_FOLDS_KEY, boardFoldedByDefault);
	const columns = useMemo(() => (list ? boardColumns(list, order, agent) : []), [list, order, agent]);
	const column = target ? columns.find(({ cards }) => cards.some(({ row }) => samePullRequest(row.pr, target))) : undefined;
	const reveal = target && column ? { id: rowId(target), folds: [column.title] } : null;
	useReveal(reveal, folds, { token: reveal?.id, block: "nearest", focus: false });
	const shown = useMemo(() => shownBoardPullRequests(columns, folds.isFolded), [columns, folds.isFolded]);
	usePullRequestKeys(pulls, shown, true);
	return { columns, folds };
}

/** The card the pointer carries: its badge, number, title, and reason, under what dropping it here would do. */
function CardInHand({ card, repo, drop }: { card: BoardCard; repo: string | null; drop: BoardDrop | null }) {
	const { pr, move } = card.row;
	return (
		<div className="space-y-1.5 rounded-lg border border-border bg-background p-2.5 shadow-lg/15">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<MoveBadge move={move} />
				<span className="ml-auto tabular-nums">{repo ? `${repo}#${pr.number}` : `#${pr.number}`}</span>
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
	column: BoardColumn;
	open: boolean;
	toggle: () => void;
	/** What dropping the card in hand on this column does; `null` when nothing is in hand, or it came from here. */
	drop: BoardDrop | null;
	/** The height of the card in hand, which its slot takes. */
	slotHeight: number;
	cardProps: (card: BoardCard) => CardProps;
}

/**
 * An open column with cards: its title and count, which fold it, then the slot a card in hand would land in, or why it
 * cannot, then its cards. A folded or empty column is a narrow strip that still takes a drop.
 */
function Column({ column: { title, cards }, open, toggle, drop, slotHeight, cardProps }: ColumnProps) {
	const { id } = boardColumnTarget(title);
	const listId = sectionId("pull-requests-board", title);
	const lands = drop !== null && drop.kind !== "refused";
	const look = cn(
		"shrink-0 scroll-mt-6 rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
		lands && "bg-primary/5 ring-1 ring-primary/40",
		drop?.kind === "refused" && "bg-red-500/5 ring-1 ring-red-500/40",
	);
	// Focused when its sidebar link is chosen.
	const section = { id, tabIndex: -1, [COLUMN_KEY]: title };
	if (!open || cards.length === 0) {
		return (
			<section {...section} aria-label={title} className={cn(look, "flex min-h-48 w-10 flex-col items-center self-stretch py-2", !drop && "bg-muted/30")}>
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
	return (
		<section {...section} aria-labelledby={`${listId}-title`} className={cn(look, "flex w-72 flex-col gap-2 p-2", !drop && "bg-muted/40")}>
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
						animate={{ height: slotHeight, opacity: 1 }}
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
				{cards.map(card => (
					<PullRequestCard key={prKey(card.row.pr)} {...cardProps(card)} />
				))}
			</ul>
		</section>
	);
}

/**
 * The board of `pulls`, whose sidebar link `section` unfolds, scrolls to, and focuses a column. A card dragged past a
 * few pixels lifts and tilts with its speed; the column under it shows the slot it would land in, labeled with what the
 * drop does, or turns red with why it cannot. Releasing settles the card into the slot and runs the drop, or springs it
 * back; Esc puts it back. Space on a focused card picks it up for the keys, and a live region says each step.
 */
export function PullRequestsKanban({ pulls, section }: { pulls: PullRequests; section: SectionTarget | null }) {
	const { rowBase, onQuickAction, onChange } = pulls;
	const { columns, folds } = usePullRequestsColumns(pulls);
	useReveal(section, folds, { token: section, block: "start", focus: true });
	const reduced = useReducedMotion();
	const scroller = useRef<HTMLDivElement>(null);
	const [hold, setHold] = useState<Hold | null>(null);
	const drop = hold && boardDrop(hold.card.row, hold.from, hold.over);
	/** The card waiting on GitHub after a drop, by {@link prKey}. */
	const [moving, setMoving] = useState<string | null>(null);
	/** The card whose merge confirmation is open, by {@link prKey}, which a drop on **Recently merged** opens. */
	const [confirming, setConfirming] = useState<string | null>(null);
	const [said, say] = useState("");
	/** The card a press is on, with where it sat, until the press lifts it or lets go. */
	const pressed = useRef<{ card: BoardCard; from: MoveGroup; box: DOMRect } | null>(null);
	/** The pull request whose card the keys dropped, whose link takes focus back once the card shows in its new column. */
	const refocus = useRef<PullRequest | null>(null);
	const x = useMotionValue(0);
	const y = useMotionValue(0);
	const rotate = useSpring(useTransform(useVelocity(x), [-1600, 0, 1600], [-7, 0, 7], { clamp: true }), { stiffness: 500, damping: 32 });

	const change = useAction(async (card: BoardCard, next: ListChange) => {
		const key = prKey(card.row.pr);
		setMoving(key);
		try {
			await onChange(card.row.pr, next);
		} finally {
			setMoving(current => (current === key ? null : current));
		}
	}, "GitHub refused the change");
	const onMergeOpenChange = useCallback((pr: PullRequest, open: boolean) => setConfirming(open ? prKey(pr) : null), []);

	const several = useMemo(() => new Set(columns.flatMap(({ cards }) => cards.map(({ repo }) => repo))).size > 1, [columns]);
	const heldKey = hold && prKey(hold.card.row.pr);
	const cardProps = (card: BoardCard): CardProps => {
		const key = prKey(card.row.pr);
		return {
			...rowBase(card.row, card.cwd),
			repo: several ? card.repo : null,
			mergeOpen: key === confirming,
			onMergeOpenChange,
			held: key === heldKey ? (hold!.by === "pointer" ? "lifted" : "picked") : key === moving ? "moving" : null,
		};
	};

	const find = (key: string): { card: BoardCard; from: MoveGroup } | null => {
		for (const { title, cards } of columns) for (const card of cards) if (prKey(card.row.pr) === key) return { card, from: title };
		return null;
	};

	/** Lets go of `held` over its column, where it does `dropped`: runs it there, or says why it cannot or that the card stayed. */
	const release = (held: Hold, dropped: BoardDrop | null): void => {
		const { pr } = held.card.row;
		setHold(null);
		if (dropped === null) return say(`${pullRequestName(pr)} stays in ${held.from}`);
		if (dropped.kind === "refused") return say(`${pullRequestName(pr)} cannot move to ${held.over}: ${dropped.why}`);
		say(`${dropped.label}: ${pullRequestName(pr)}`);
		if (held.by === "keys") refocus.current = pr;
		if (dropped.kind === "agent") onQuickAction(pr, held.card.cwd, dropped.action);
		else if (dropped.kind === "merge") setConfirming(prKey(pr));
		else change.run(held.card, { field: "state", state: dropped.state });
	};

	/** Springs the card in the pointer's hand into the slot where `dropped` lands it, or back onto its own card, then lets go of it. */
	const settle = async (held: Hold, dropped: BoardDrop | null): Promise<void> => {
		const column = dropped && dropped.kind !== "refused" ? document.querySelector(`[${COLUMN_KEY}="${held.over}"]`) : null;
		// The column stands in for its slot while the slot is not drawn yet.
		const into = column ? (column.querySelector(`[${SLOT_KEY}]`) ?? column) : rowElement(held.card.row.pr);
		if (into && !reduced) {
			const { left, top } = into.getBoundingClientRect();
			await Promise.all([animate(x, left, SETTLE), animate(y, top, SETTLE)]);
		}
		release(held, dropped);
	};

	const drag = usePointerDrag({
		liftDistance: LIFT_DISTANCE,
		scroller,
		onPress: event => {
			const target = event.target as Element;
			if (hold || target.closest("button, input, textarea, [role=menuitem]")) return false;
			const element = target.closest<HTMLElement>(`[${CARD_KEY}]`);
			const found = element && find(element.getAttribute(CARD_KEY)!);
			if (!element || !found) return false;
			pressed.current = { ...found, box: element.getBoundingClientRect() };
			return true;
		},
		onLift: () => {
			const { card, from, box } = pressed.current!;
			x.jump(box.left);
			y.jump(box.top);
			setHold({ card, from, over: from, by: "pointer", width: box.width, height: box.height });
		},
		onMove: (point, moved) => {
			const { from, box } = pressed.current!;
			x.set(box.left + moved.x);
			y.set(box.top + moved.y);
			const over = columnAt(point.x, point.y) ?? from;
			setHold(current => (current && current.over !== over ? { ...current, over } : current));
		},
		onDrop: () => {
			if (hold) void settle(hold, drop);
		},
		onCancel: () => {
			if (hold) void settle({ ...hold, over: hold.from }, null);
		},
	});

	useShortcuts({
		liftPullRequest: () => {
			const active = document.activeElement;
			const element = active instanceof HTMLAnchorElement ? active.closest<HTMLElement>(`[${CARD_KEY}]`) : null;
			const found = !hold && element && find(element.getAttribute(CARD_KEY)!);
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
					const next = boardDrop(hold.card.row, hold.from, over);
					say(`${over}: ${next ? dropText(next) : "where it is now"}`);
					document.querySelector(`[${COLUMN_KEY}="${over}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
				}
			} else if (event.key === " " || event.key === "Enter") {
				release(hold, drop);
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
		// `drop` and `release` follow `hold`, and a drop's work reads nothing that changes while a card is in hand.
	}, [hold, columns, reduced]);

	useEffect(() => {
		const pr = refocus.current;
		if (!pr || document.activeElement !== document.body) return;
		const link = rowLink(pr);
		if (!link) return;
		link.focus({ preventScroll: true });
		link.scrollIntoView({ block: "nearest", inline: "nearest" });
		refocus.current = null;
	}, [columns]);

	return (
		<>
			<p role="status" aria-live="assertive" className="sr-only">
				{said}
			</p>
			<div ref={scroller} {...drag} className="-mx-6 flex min-h-0 items-start gap-3 overflow-x-auto px-6 pt-1 pb-6">
				{columns.map(column => (
					<Column
						key={column.title}
						column={column}
						open={!folds.isFolded(column.title)}
						toggle={() => folds.toggle(column.title)}
						drop={hold?.over === column.title ? drop : null}
						slotHeight={hold?.height ?? 56}
						cardProps={cardProps}
					/>
				))}
			</div>
			{hold?.by === "pointer" &&
				createPortal(
					<motion.div aria-hidden style={{ x, y, rotate, width: hold.width }} className="pointer-events-none fixed top-0 left-0 z-50 cursor-grabbing">
						<CardInHand card={hold.card} repo={several ? hold.card.repo : null} drop={drop} />
					</motion.div>,
					document.body,
				)}
		</>
	);
}
