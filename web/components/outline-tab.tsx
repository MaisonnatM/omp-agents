import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { skillLabel } from "../labels";
import type { OutlineTurn } from "../transcript-view";

/** The transcript's own top padding, kept above the message so it does not sit under the viewport's edge fade. */
const SCROLL_GAP = 12;

/** How far below the viewport's top edge a prompt may sit and still count as the turn being read. */
const READING_LINE = 96;

const VIEWPORT = '[data-slot="message-scroller-viewport"]';

const focusedMessage = (id: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[data-pane][data-focused] [data-message-id="${CSS.escape(id)}"]`);

/**
 * Scrolls the focused pane's transcript to a message. It sets the transcript's viewport alone, since
 * `scrollIntoView` would also scroll the pane's clipped ancestors.
 */
function scrollToMessage(id: string, behavior: ScrollBehavior): void {
	const message = focusedMessage(id);
	const viewport = message?.closest<HTMLElement>(VIEWPORT);
	if (!message || !viewport) return;
	const top = viewport.scrollTop + message.getBoundingClientRect().top - viewport.getBoundingClientRect().top - SCROLL_GAP;
	viewport.scrollTo({ top, behavior });
}

/** The turn whose prompt last crossed the reading line of the focused transcript. */
function readingTurn(turns: OutlineTurn[], viewport: HTMLElement): string | null {
	const line = viewport.getBoundingClientRect().top + READING_LINE;
	let current: string | null = turns[0]?.id ?? null;
	for (const turn of turns) {
		const message = focusedMessage(turn.id);
		if (!message) continue;
		if (message.getBoundingClientRect().top > line) break;
		current = turn.id;
	}
	return current;
}

/** Gestures that mean the reader scrolls the transcript themselves, which ends a jump's pin. */
const READER_SCROLL = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Follows the focused transcript's scroll and names the turn being read. A jump pins its turn until the reader
 * scrolls, since the last turns can sit below the reading line even at the transcript's end.
 */
function useReadingTurn(turns: OutlineTurn[]): { current: string | null; pin: (id: string) => void } {
	const [current, setCurrent] = useState<string | null>(null);
	const pinned = useRef<string | null>(null);
	useEffect(() => {
		const viewport = turns[0] && focusedMessage(turns[0].id)?.closest<HTMLElement>(VIEWPORT);
		if (!viewport) return;
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => setCurrent(pinned.current ?? readingTurn(turns, viewport)));
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
	}, [turns]);
	const pin = (id: string) => {
		pinned.current = id;
		setCurrent(id);
	};
	return { current, pin };
}

/** A leading bold label such as `**Résumé**` or `**Summary:**`, which every reply of a format repeats. */
const LEAD_LABEL = /^\s*\*\*[^*\n]{1,24}\*\*\s*[:.—–-]?\s*/;

/** Markdown read as the words it renders, on one line, so `**Résumé** Done.` reads as `Done.` */
const plain = (text: string): string =>
	text
		.replace(LEAD_LABEL, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
		.replace(/\*\*|__|`/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** Cut long before the row would show it all, so a long reply's accessible name stays short. */
const excerpt = (text: string): string => plain(text).slice(0, 240);

const LINE = "block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TurnRow({ turn, index, current, onJump }: { turn: OutlineTurn; index: number; current: boolean; onJump: (messageId: string, turnId: string) => void }) {
	const ref = useRef<HTMLLIElement>(null);
	useEffect(() => {
		const row = ref.current;
		if (!current || !row) return;
		let scroller = row.parentElement;
		while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
		if (!scroller) return;
		const rowBox = row.getBoundingClientRect();
		const box = scroller.getBoundingClientRect();
		if (rowBox.top < box.top) scroller.scrollTop -= box.top - rowBox.top;
		else if (rowBox.bottom > box.bottom) scroller.scrollTop += rowBox.bottom - box.bottom;
	}, [current]);
	const skill = turn.skill && skillLabel(turn.skill);
	const note = turn.tools > 0 ? `${turn.tools} ${turn.tools === 1 ? "tool" : "tools"}` : null;
	return (
		<li
			ref={ref}
			aria-current={current ? "step" : undefined}
			className={cn(
				"group relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 rounded-md py-1.5 pr-2 pl-1 transition-colors",
				current ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
			)}
		>
			<span
				aria-hidden
				className={cn("absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full", current ? "bg-foreground/70" : "bg-transparent")}
			/>
			<span aria-hidden className={cn("text-right text-xs leading-5 tabular-nums", current ? "text-foreground" : "text-muted-foreground/70")}>
				{index + 1}
			</span>
			<div className="min-w-0 space-y-0.5">
				<button type="button" onClick={() => onJump(turn.id, turn.id)} title={plain(turn.prompt)} className={cn(LINE, "text-[13px] leading-5 font-medium text-foreground")}>
					<span className="line-clamp-2">
						<span className="sr-only">Turn {index + 1}: </span>
						{skill && <span className="mr-1.5 rounded px-1 py-px text-[11px] ring-1 ring-border ring-inset">{skill}</span>}
						{excerpt(turn.prompt)}
					</span>
				</button>
				{turn.reply ? (
					<button type="button" onClick={() => onJump(turn.reply!.id, turn.id)} title={plain(turn.reply.text)} className={cn(LINE, "text-xs leading-[1.125rem] text-muted-foreground hover:text-foreground")}>
						<span className="sr-only">Reply: </span>
						<span className="line-clamp-2">{excerpt(turn.reply.text)}</span>
					</button>
				) : turn.running ? (
					<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span aria-hidden className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
						Working…
					</p>
				) : null}
				{(note || turn.failed > 0) && (
					<p className="text-[11px] leading-4 text-muted-foreground/80 tabular-nums">
						{note}
						{turn.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {turn.failed} failed</span>}
					</p>
				)}
			</div>
		</li>
	);
}

/** The view's turns, in order: each prompt with the reply it ended on; a line scrolls the pane's transcript to its message. */
export function OutlineTab({ turns, loaded }: { turns: OutlineTurn[]; loaded: boolean }) {
	const reduceMotion = useReducedMotion() ?? false;
	const { current, pin } = useReadingTurn(turns);
	if (!loaded) return <p className="px-4 py-2 text-sm text-muted-foreground">Loading the conversation…</p>;
	if (turns.length === 0) return <p className="px-4 py-2 text-sm text-muted-foreground">No messages yet.</p>;
	const jump = (messageId: string, turnId: string) => {
		pin(turnId);
		scrollToMessage(messageId, reduceMotion ? "auto" : "smooth");
	};
	return (
		<nav aria-label="Conversation outline" className="px-2 py-2">
			<ol className="space-y-0.5">
				{turns.map((turn, index) => (
					<TurnRow key={turn.id} turn={turn} index={index} current={turn.id === current} onJump={jump} />
				))}
			</ol>
		</nav>
	);
}
