/**
 * The transcript's minimap, after Notra's Chat Minimap (https://ui.usenotra.com/components/chat-minimap): a rail of
 * lines on the transcript's left edge, one per turn. The hovered line grows most and its neighbours less, hovering one
 * previews its turn, and a click scrolls the transcript to its prompt.
 */
import { useReducedMotion } from "framer-motion";
import { type ComponentProps, memo, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../../src/shared/transcript";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { plainMarkdown, skillLabel } from "../labels";
import { type OutlineTurn, outline } from "../transcript-view";
import { TaskIcon } from "./routines/routine-marks";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Tooltip } from "./ui/tooltip";

/** The transcript's own top padding, kept above the message so it does not sit under the viewport's edge fade. */
const SCROLL_GAP = 12;

/** How far below the viewport's top edge a prompt may sit and still count as the turn being read. */
const READING_LINE = 96;

const VIEWPORT = '[data-slot="message-scroller-viewport"]';

/** Gestures that mean the reader scrolls the transcript themselves, which ends a jump's pin. */
const READER_SCROLL = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** The transcript viewport around `inside`, which sits in the same `MessageScroller`. */
export const viewportOf = (inside: HTMLElement | null): HTMLElement | null =>
	inside?.closest('[data-slot="message-scroller"]')?.querySelector<HTMLElement>(VIEWPORT) ?? null;

export const messageIn = (viewport: HTMLElement, id: string): HTMLElement | null =>
	viewport.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);

/** Scrolls `viewport` alone to `message`, since `scrollIntoView` would also scroll the pane's clipped ancestors. */
export function scrollToMessage(viewport: HTMLElement, message: HTMLElement, reduceMotion: boolean): void {
	const top = viewport.scrollTop + message.getBoundingClientRect().top - viewport.getBoundingClientRect().top - SCROLL_GAP;
	viewport.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
}

/** The turn whose prompt last crossed the reading line. */
function readingTurn(turns: OutlineTurn[], viewport: HTMLElement): string | null {
	const line = viewport.getBoundingClientRect().top + READING_LINE;
	let current: string | null = turns[0]?.id ?? null;
	for (const turn of turns) {
		const message = messageIn(viewport, turn.id);
		if (!message) continue;
		if (message.getBoundingClientRect().top > line) break;
		current = turn.id;
	}
	return current;
}

/**
 * Follows the transcript's scroll and names the turn being read. A jump pins its turn until the reader scrolls, since
 * the last turns can sit below the reading line even at the transcript's end. The listeners follow the turns' ids, not
 * each streamed token: the scroll handler reads the latest `turns`.
 */
function useReadingTurn(turns: OutlineTurn[], rail: RefObject<HTMLElement | null>): { current: string | null; jump: (id: string) => void } {
	const [current, setCurrent] = useState<string | null>(null);
	const pinned = useRef<string | null>(null);
	const latest = useRef(turns);
	latest.current = turns;
	const reduceMotion = useReducedMotion() ?? false;
	const key = turns.map(turn => turn.id).join("\n");
	useEffect(() => {
		const viewport = viewportOf(rail.current);
		if (!viewport) return;
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => setCurrent(pinned.current ?? readingTurn(latest.current, viewport)));
		};
		const unpin = () => {
			pinned.current = null;
		};
		update();
		viewport.addEventListener("scroll", update, { passive: true });
		for (const type of READER_SCROLL) viewport.addEventListener(type, unpin, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			viewport.removeEventListener("scroll", update);
			for (const type of READER_SCROLL) viewport.removeEventListener(type, unpin);
		};
	}, [key, rail]);
	const jump = (id: string) => {
		const viewport = viewportOf(rail.current);
		const message = viewport && messageIn(viewport, id);
		if (!viewport || !message) return;
		pinned.current = id;
		setCurrent(id);
		scrollToMessage(viewport, message, reduceMotion);
	};
	return { current, jump };
}

/** Cut long before the card would show it all, so a long message's accessible name stays short. */
const excerpt = (text: string): string => plainMarkdown(text).slice(0, 240);

const titleOf = (turn: OutlineTurn): string =>
	[turn.routine?.name ?? (turn.skill && skillLabel(turn.skill)), excerpt(turn.prompt)].filter(Boolean).join(" · ") || "Prompt";

const descriptionOf = (turn: OutlineTurn): string | null => (turn.reply ? excerpt(turn.reply.text) : turn.running ? "Working…" : null);

/**
 * The hovered line grows to 24px, its neighbours to 20px, and the ones past them to 16px; every other line rests at
 * 12px. Neighbours brighten the same way.
 */
const FALLOFF =
	"[&:is(:hover,:focus-visible)_svg]:w-6 [&:has(+[data-slot=minimap-line]:is(:hover,:focus-visible))_svg]:w-5 [[data-slot=minimap-line]:is(:hover,:focus-visible)+&_svg]:w-5 [&:has(+*+[data-slot=minimap-line]:is(:hover,:focus-visible))_svg]:w-4 [[data-slot=minimap-line]:is(:hover,:focus-visible)+*+&_svg]:w-4 [&:has(+[data-slot=minimap-line]:is(:hover,:focus-visible))]:text-foreground/75 [[data-slot=minimap-line]:is(:hover,:focus-visible)+&]:text-foreground/75 [&:has(+*+[data-slot=minimap-line]:is(:hover,:focus-visible))]:text-foreground/55 [[data-slot=minimap-line]:is(:hover,:focus-visible)+*+&]:text-foreground/55";

const RAIL_BUTTON = "flex w-8 shrink-0 cursor-pointer items-center justify-start px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Line({ turn, index, active, onJump }: { turn: OutlineTurn; index: number; active: boolean; onJump: (id: string) => void }) {
	const title = titleOf(turn);
	const description = descriptionOf(turn);
	return (
		<HoverCard openDelay={80} closeDelay={100}>
			<HoverCardTrigger asChild>
				<button
					{...activityControl("minimap.jump")}
					type="button"
					data-slot="minimap-line"
					data-active={active || undefined}
					aria-current={active ? "step" : undefined}
					onClick={() => onJump(turn.id)}
					className={cn(RAIL_BUTTON, "h-2 text-muted-foreground/40 transition-colors hover:text-foreground focus-visible:text-foreground data-active:text-foreground data-[state=open]:text-foreground", FALLOFF)}
				>
					<svg aria-hidden="true" viewBox="0 0 24 2" preserveAspectRatio="none" className="h-0.5 w-3 overflow-visible transition-[width] duration-200 ease-out motion-reduce:transition-none">
						<rect fill="currentColor" width="24" height="2" />
					</svg>
					<span className="sr-only">
						Turn {index + 1}: {title}
					</span>
				</button>
			</HoverCardTrigger>
			<HoverCardContent side="right" align="center" sideOffset={8} className="w-64 p-3">
				<p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
					{turn.routine && <TaskIcon task={turn.routine.task} className="size-3.5 shrink-0 text-muted-foreground" />}
					<span className="truncate">{title}</span>
				</p>
				{description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{description}</p>}
			</HoverCardContent>
		</HoverCard>
	);
}

function Step({ direction, disabled, onClick }: { direction: "previous" | "next"; disabled: boolean; onClick: ComponentProps<"button">["onClick"] }) {
	const label = direction === "previous" ? "Previous turn" : "Next turn";
	return (
		<Tooltip content={label} side={direction === "previous" ? "top" : "bottom"}>
			<button
				{...activityControl("minimap.step")}
				type="button"
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
				className={cn(
					RAIL_BUTTON,
					"h-5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none motion-reduce:transition-none pointer-coarse:opacity-100",
				)}
			>
				<svg aria-hidden="true" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn("w-2.5", direction === "next" && "rotate-180")}>
					<path d="M.75 5.25 5 1l4.25 4.25" />
				</svg>
			</button>
		</Tooltip>
	);
}

/**
 * The rail for a transcript's turns, on its left edge. It shows from two turns on, and only where the pane leaves room
 * beside the transcript's column; the line of the turn being read stays lit.
 */
export const TranscriptMinimap = memo(function TranscriptMinimap({ items, working }: { items: Item[]; working: boolean }) {
	const turns = useMemo(() => outline(items, working), [items, working]);
	const rail = useRef<HTMLElement>(null);
	const { current, jump } = useReadingTurn(turns, rail);
	if (turns.length < 2) return null;
	const at = turns.findIndex(turn => turn.id === current);
	return (
		<nav
			ref={rail}
			aria-label="Conversation turns"
			className="absolute top-1/2 left-2 z-10 hidden max-h-[calc(100%-4rem)] -translate-y-1/2 flex-col overflow-y-auto [scrollbar-width:none] @[54rem]:flex"
		>
			<Step direction="previous" disabled={at <= 0} onClick={() => jump(turns[at - 1]!.id)} />
			{turns.map((turn, index) => (
				<Line key={turn.id} turn={turn} index={index} active={turn.id === current} onJump={jump} />
			))}
			<Step direction="next" disabled={at >= turns.length - 1} onClick={() => jump(turns[at + 1]!.id)} />
		</nav>
	);
});
