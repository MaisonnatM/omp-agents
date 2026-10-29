/**
 * Chat history, after Kobra's Chat History (https://kobra.systems/components/chat-history): a composer button that
 * blurs the transcript and gathers every prompt of the session into one column over it. Prompts in view slide from
 * their place in the transcript into the column; a click on one scrolls the transcript to it and tints its bubble.
 */
import { motion, useReducedMotion } from "framer-motion";
import { History, X } from "lucide-react";
import { type KeyboardEvent, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { View } from "../../src/shared/sessions";
import type { Item } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useShape } from "@/lib/shape-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { keyedStore } from "../keyed-store";
import { skillLabel } from "../labels";
import { useTranscript } from "../pane-store";
import { hashForView } from "../routing";
import { outline } from "../transcript-view";
import { messageIn, scrollToMessage, viewportOf } from "./transcript-minimap";

/** Whether a view's chat history is open, by the view's hash. */
const opened = keyedStore<boolean>(false);

const triggerId = (view: View): string => `prompt-history-trigger-${hashForView(view)}`;
const panelId = (view: View): string => `prompt-history-${hashForView(view)}`;

/** How long a picked prompt's bubble stays tinted. */
const FLASH_MS = 1400;

/** Prompts a session needs before its history earns a button: one prompt is already the whole transcript. */
const MIN_PROMPTS = 2;

const close = (view: View, refocus: boolean): void => {
	opened.set(hashForView(view), false);
	if (refocus) document.getElementById(triggerId(view))?.focus();
};

/** The composer's button that opens and closes the chat history; it shows from two prompts on. */
export const PromptHistoryButton = memo(function PromptHistoryButton({ view }: { view: View }) {
	const items = useTranscript(view);
	const prompts = useMemo(() => items.reduce((count, item) => count + (item.kind === "user" ? 1 : 0), 0), [items]);
	const open = opened.use(hashForView(view));
	if (prompts < MIN_PROMPTS) return null;
	return (
		<Tooltip content={open ? "Close chat history" : "Chat history: every prompt you sent"} side="top">
			<Button
				{...activityControl("prompt-history.toggle")}
				id={triggerId(view)}
				variant="ghost"
				size="icon-sm"
				aria-label={open ? "Close chat history" : "Chat history"}
				aria-expanded={open}
				aria-controls={open ? panelId(view) : undefined}
				onClick={() => opened.set(hashForView(view), !open)}
			>
				{open ? <X aria-hidden="true" /> : <History aria-hidden="true" />}
			</Button>
		</Tooltip>
	);
});

/** Tints a prompt's bubble after a jump, so the eye finds it among the replies. */
function flash(message: HTMLElement): void {
	const bubble = message.querySelector<HTMLElement>('[data-item="user"] > .whitespace-pre-wrap') ?? message;
	bubble.animate(
		[{ boxShadow: "0 0 0 2px var(--focus-ring)", filter: "brightness(0.92)" }, { boxShadow: "0 0 0 2px transparent", filter: "none" }],
		{ duration: FLASH_MS, easing: "ease-out" },
	);
}

/** How far each prompt in view sits below its slot in the column, by id, so it can slide up from there. */
function startOffsets(viewport: HTMLElement, column: HTMLElement): Map<string, number> {
	const offsets = new Map<string, number>();
	const view = viewport.getBoundingClientRect();
	for (const slot of column.querySelectorAll<HTMLElement>("[data-prompt-id]")) {
		const id = slot.dataset.promptId!;
		const bubble = messageIn(viewport, id)?.querySelector<HTMLElement>('[data-item="user"]');
		const from = bubble?.getBoundingClientRect();
		if (!from || from.bottom < view.top || from.top > view.bottom) continue;
		offsets.set(id, from.top - slot.getBoundingClientRect().top);
	}
	return offsets;
}

/** The blurred layer over the transcript with the session's prompts, newest at the bottom beside the composer. */
export const PromptHistory = memo(function PromptHistory({ view, items, working }: { view: View; items: Item[]; working: boolean }) {
	const open = opened.use(hashForView(view));
	if (!open) return null;
	return <Panel view={view} items={items} working={working} />;
});

function Panel({ view, items, working }: { view: View; items: Item[]; working: boolean }) {
	const turns = useMemo(() => outline(items, working).filter(turn => !turn.routine), [items, working]);
	const reduceMotion = useReducedMotion() ?? false;
	const shape = useShape();
	const column = useRef<HTMLOListElement>(null);
	// The first pass lays the column out unseen; its slots are measured against the transcript before the first paint,
	// and the second pass mounts the prompts where the reader saw them.
	const [offsets, setOffsets] = useState<Map<string, number> | null>(null);
	useLayoutEffect(() => {
		const list = column.current;
		const viewport = viewportOf(list);
		if (list) list.scrollTop = list.scrollHeight;
		setOffsets(list && viewport ? startOffsets(viewport, list) : new Map());
	}, []);
	useEffect(() => {
		if (offsets) column.current?.querySelector<HTMLElement>("li:last-child button")?.focus({ preventScroll: true });
	}, [offsets]);
	// Leaving the transcript, for the trajectory or another view, closes the history rather than keeping it for later.
	useEffect(() => () => close(view, false), [view]);
	const pick = (id: string) => {
		const viewport = viewportOf(column.current);
		const message = viewport && messageIn(viewport, id);
		close(view, true);
		if (!viewport || !message) return;
		scrollToMessage(viewport, message, reduceMotion);
		flash(message);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
		event.preventDefault();
		event.stopPropagation();
		close(view, true);
	};
	const count = turns.length;
	return (
		<motion.div
			id={panelId(view)}
			role="dialog"
			aria-label="Chat history"
			className="absolute inset-0 z-20 flex flex-col bg-background/40 backdrop-blur-md"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: reduceMotion ? 0 : 0.18 }}
			onKeyDown={onKeyDown}
			onClick={event => {
				if (event.target === event.currentTarget) close(view, true);
			}}
		>
			<ol
				ref={column}
				aria-label={`${count} prompts`}
				className="mx-auto flex min-h-0 w-full max-w-conversation flex-1 flex-col gap-3 overflow-y-auto p-3 [scrollbar-width:thin] before:mt-auto before:content-['']"
				onClick={event => {
					if (event.target === event.currentTarget) close(view, true);
				}}
			>
				{turns.map((turn, index) => {
					const from = offsets?.get(turn.id);
					const stagger = reduceMotion ? 0 : Math.min(count - 1 - index, 12) * 0.02;
					return (
						<motion.li
							key={`${turn.id}${offsets ? "" : "-measure"}`}
							data-prompt-id={turn.id}
							className={cn("flex max-w-[80%] flex-col items-end self-end", !offsets && "invisible")}
							initial={!offsets ? false : reduceMotion ? { opacity: 0 } : from !== undefined ? { y: from } : { opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							transition={from !== undefined ? spring.moderate : { ...spring.moderate, delay: stagger }}
						>
							<button
								{...activityControl("prompt-history.jump")}
								type="button"
								onClick={() => pick(turn.id)}
								className={cn(
									"max-w-full cursor-pointer px-3.5 py-2 text-left text-[14px] whitespace-pre-wrap break-words outline-none",
									shape.bg,
									"bg-[color-mix(in_oklab,var(--accent),var(--background)_45%)] text-accent-foreground",
									"transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
									turn.nudge && "text-muted-foreground",
								)}
							>
								<span className="line-clamp-3">
									{turn.skill && <span className="font-medium">{skillLabel(turn.skill)} · </span>}
									{turn.prompt}
								</span>
							</button>
						</motion.li>
					);
				})}
			</ol>
		</motion.div>
	);
}
