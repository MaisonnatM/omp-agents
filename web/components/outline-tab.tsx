import { useReducedMotion } from "framer-motion";
import { Bot, Check, ChevronDown, ListChecks, Loader, type LucideIcon, Play, User } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { skillLabel } from "../labels";
import type { OutlineTurn } from "../transcript-view";
import { MessageMarkdown } from "./message-markdown";
import { SkillBadge } from "./transcript";

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

const JUMP = "block w-full rounded-sm text-left [overflow-wrap:anywhere] outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Jump = (messageId: string, turnId: string) => void;

/** How each nudge reads on the rail. An approval keeps its words, since `go all don't commit` says more than `go`. */
const NUDGES = {
	approve: { icon: Check, tone: "text-emerald-600 dark:text-emerald-400", label: "Approved" },
	resume: { icon: Play, tone: "text-muted-foreground", label: "Continued" },
} satisfies Record<NonNullable<OutlineTurn["nudge"]>, { icon: LucideIcon; tone: string; label: string }>;

/** How tall a plan shows before **Show more**, in pixels: about twelve lines. */
const PLAN_HEIGHT = 240;

/**
 * One entry on the outline's rail: its mark, and the line that joins it to the entries above and below.
 * The line runs through the padding, so it stays unbroken across turns and their highlight.
 */
function Entry({ icon: Icon, tone, first, last, children }: { icon: LucideIcon; tone: string; first: boolean; last: boolean; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5">
			<div aria-hidden className="flex flex-col items-center">
				<span className={cn("h-2 w-px", !first && "bg-border")} />
				<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sidebar ring-1 ring-border">
					<Icon className={cn("size-3", tone)} />
				</span>
				<span className={cn("w-px flex-1", !last && "bg-border")} />
			</div>
			<div className="min-w-0 pt-2 pb-3">{children}</div>
		</div>
	);
}

/** A plan's text, cut at {@link PLAN_HEIGHT} behind a fade until the reader opens it. */
function PlanBody({ text }: { text: string }) {
	const box = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [long, setLong] = useState(false);
	useLayoutEffect(() => {
		const content = box.current?.firstElementChild;
		if (!content) return;
		const measure = () => setLong(content.scrollHeight > PLAN_HEIGHT);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, []);
	const folded = long && !open;
	return (
		<div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
			<div
				ref={box}
				style={folded ? { maxHeight: PLAN_HEIGHT } : undefined}
				className={cn("overflow-hidden text-[13px] leading-5", folded && "[mask-image:linear-gradient(to_bottom,black_65%,transparent)]")}
			>
				<MessageMarkdown text={text} />
			</div>
			{long && (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
					{open ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}

/** The turn's tool calls and, in red, those that failed: `14 tools · 2 failed`. */
function ToolCount({ turn }: { turn: OutlineTurn }) {
	if (turn.tools === 0) return null;
	return (
		<p className="mt-1 text-[11px] leading-4 text-muted-foreground/80 tabular-nums">
			{turn.tools} {turn.tools === 1 ? "tool" : "tools"}
			{turn.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {turn.failed} failed</span>}
		</p>
	);
}

/**
 * A turn on the rail. The first prompt reads whole as the request, a nudge such as `go` or `continue` reads as one line,
 * and a reply that the next prompt approved reads as the plan; any other prompt and reply show their first lines.
 */
function TurnRow({ turn, index, plan, last, current, onJump }: { turn: OutlineTurn; index: number; plan: boolean; last: boolean; current: boolean; onJump: Jump }) {
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
	const tone = current ? "text-foreground" : "text-muted-foreground";
	const promptLast = last && !turn.reply && !turn.running;
	return (
		<li ref={ref} aria-current={current ? "step" : undefined} className={cn("rounded-md px-1.5 transition-colors", current && "bg-foreground/[0.04]")}>
			{index === 0 ? (
				<div className="pt-2 pb-3">
					<button type="button" onClick={() => onJump(turn.id, turn.id)} className={cn(JUMP, "w-auto text-xs font-medium text-muted-foreground hover:text-foreground")}>
						<span className="sr-only">Turn 1: </span>
						Request
					</button>
					<div className="mt-1.5 flex flex-col items-start gap-1.5 text-[13px] leading-5 text-foreground">
						{turn.skill && <SkillBadge name={turn.skill} />}
						{turn.prompt && <MessageMarkdown text={turn.prompt} />}
					</div>
				</div>
			) : turn.nudge ? (
				<Entry icon={NUDGES[turn.nudge].icon} tone={NUDGES[turn.nudge].tone} first={false} last={promptLast}>
					<button type="button" onClick={() => onJump(turn.id, turn.id)} title={turn.prompt} className={cn(JUMP, "text-xs leading-5 text-muted-foreground hover:text-foreground")}>
						<span className="line-clamp-2">
							<span className="sr-only">Turn {index + 1}: </span>
							<span className="font-medium text-foreground">{NUDGES[turn.nudge].label}</span>
							{turn.nudge === "approve" && ` · ${turn.prompt}`}
						</span>
					</button>
				</Entry>
			) : (
				<Entry icon={User} tone={tone} first={false} last={promptLast}>
					<button type="button" onClick={() => onJump(turn.id, turn.id)} title={plain(turn.prompt)} className={cn(JUMP, "text-[13px] leading-5 font-medium text-foreground")}>
						<span className="line-clamp-3">
							<span className="sr-only">Turn {index + 1}: </span>
							{turn.skill && <span className="mr-1.5 rounded px-1 py-px text-[11px] ring-1 ring-border ring-inset">{skillLabel(turn.skill)}</span>}
							{excerpt(turn.prompt)}
						</span>
					</button>
				</Entry>
			)}
			{turn.reply && plan ? (
				<Entry icon={ListChecks} tone="text-violet-600 dark:text-violet-400" first={index === 0} last={last}>
					<button type="button" onClick={() => onJump(turn.reply!.id, turn.id)} className={cn(JUMP, "w-auto text-xs leading-5 font-medium text-foreground hover:text-muted-foreground")}>
						Plan
					</button>
					<PlanBody text={turn.reply.text.replace(LEAD_LABEL, "")} />
					<ToolCount turn={turn} />
				</Entry>
			) : turn.reply ? (
				<Entry icon={Bot} tone={tone} first={index === 0} last={last}>
					<button type="button" onClick={() => onJump(turn.reply!.id, turn.id)} title={plain(turn.reply.text)} className={cn(JUMP, "text-[13px] leading-5 text-muted-foreground hover:text-foreground")}>
						<span className="sr-only">Reply: </span>
						<span className="line-clamp-3">{excerpt(turn.reply.text)}</span>
					</button>
					<ToolCount turn={turn} />
				</Entry>
			) : turn.running ? (
				<Entry icon={Loader} tone="animate-spin text-muted-foreground [animation-duration:2s]" first={index === 0} last={last}>
					<p className="text-xs leading-5 text-muted-foreground">Working…</p>
					<ToolCount turn={turn} />
				</Entry>
			) : null}
		</li>
	);
}

/**
 * The view's turns, in order, weighted by what matters: the first prompt whole as the request, each approved plan in
 * full behind **Show more**, approvals on one line, and the first lines of every other prompt and final reply. A line
 * scrolls the pane's transcript to its message.
 */
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
			<ol>
				{turns.map((turn, index) => (
					<TurnRow
						key={turn.id}
						turn={turn}
						index={index}
						plan={turns[index + 1]?.nudge === "approve"}
						last={index === turns.length - 1}
						current={turn.id === current}
						onJump={jump}
					/>
				))}
			</ol>
		</nav>
	);
}
