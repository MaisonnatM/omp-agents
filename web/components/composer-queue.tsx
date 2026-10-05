import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { MessageQueue } from "../../src/shared";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsTouch, useRegionHeight } from "@/components/ui/input-message";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

/** omp's queues, in the order ↑ takes them back, with the tag each queued row shows. */
const QUEUE_TAGS: [keyof MessageQueue, string][] = [
	["steering", "Steer"],
	["followUp", "Follow-up"],
];

interface QueuedItem {
	id: string;
	text: string;
	tag: string;
}

export interface QueueEntry {
	queue: keyof MessageQueue;
	item: QueuedItem;
}

/** Each id counts the earlier rows with the same text, so a row keeps its key when the one ahead of it is delivered. */
export function queuedEntries(waiting: MessageQueue | undefined): QueueEntry[] {
	return QUEUE_TAGS.flatMap(([queue, tag]) =>
		(waiting?.[queue] ?? []).map((text, index, texts) => ({
			queue,
			item: { id: `${queue}:${texts.slice(0, index).filter(t => t === text).length}:${text}`, text, tag },
		})),
	);
}

interface QueueOptions {
	waiting: MessageQueue | undefined;
	/** The server's last answer to this view's `dequeue`. */
	dequeued: { reqId: number; texts: string[] } | null;
	dequeue: (reqId: number, messages: { queue: keyof MessageQueue; text: string }[]) => void;
	/** Puts the text of the rows taken for editing back into the composer. */
	restore: (text: string) => void;
}

/** The rows waiting on the running turn, and `take`, which pulls them out before the agent gets them. */
export function useQueue({ waiting, dequeued, dequeue, restore }: QueueOptions) {
	/** The `dequeue` whose text goes back into the draft; a removed row asks for none. */
	const [dequeueId, setDequeueId] = useState<number | null>(null);
	const nextId = useRef(0);
	const queued = queuedEntries(waiting);
	/** Edited rows come back into the composer once the server took them; returns `false` when there is nothing to take. */
	const take = (entries: QueueEntry[], edit: boolean): boolean | void => {
		if (entries.length === 0) return false;
		const id = ++nextId.current;
		if (edit) setDequeueId(id);
		dequeue(id, entries.map(({ queue, item }) => ({ queue, text: item.text })));
	};
	useEffect(() => {
		if (!dequeued || dequeued.reqId !== dequeueId) return;
		setDequeueId(null);
		restore(dequeued.texts.join("\n"));
	}, [dequeued, dequeueId]);
	return { queued, take };
}

interface QueuedRowProps {
	item: QueuedItem;
	index: number;
	total: number;
	reduceMotion: boolean;
	isTouch: boolean;
	onEdit: () => void;
	onRemove: () => void;
}

/**
 * A message waiting on the running turn: a recessed row that reads as "staged, not live", led by its tag.
 * Double-click, Enter, or F2 edits it back into the composer; the hover-revealed ×, or Delete, removes it.
 */
function QueuedRow({ item, index, total, reduceMotion, isTouch, onEdit, onRemove }: QueuedRowProps) {
	const XIcon = useIcon("x");
	const compactStep = useSize().variant === "compact";
	const kind = `${item.tag.toLowerCase()} `;

	return (
		<motion.li
			layout
			// Enter: spring-fast chip category. Exit slightly faster (0.06s linear). Reduced-motion drops the scale.
			initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: spring.fast.exit }}
			transition={spring.fast}
			aria-label={`Queued ${kind}message ${index + 1} of ${total}: ${item.text}`}
			tabIndex={0}
			onDoubleClick={onEdit}
			onKeyDown={event => {
				if (event.key === "Enter" || event.key === "F2") {
					event.preventDefault();
					onEdit();
				} else if (event.key === "Delete" || event.key === "Backspace") {
					event.preventDefault();
					onRemove();
				}
			}}
			className={cn(
				// Fixed height so the text-box trim on the label doesn't shrink the row.
				"group/qrow flex items-center gap-2 rounded-lg bg-muted",
				compactStep ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[13px]",
				"text-foreground/85 select-none outline-none",
				"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
			)}
			style={{ fontVariationSettings: fontWeights.normal }}
		>
			<span className="shrink-0 text-muted-foreground [text-box:trim-both_cap_alphabetic]" style={{ fontVariationSettings: fontWeights.medium }}>
				{item.tag}
			</span>
			{/* py-1/-my-1 keeps truncate's overflow:hidden from clipping ascenders/descenders outside the trimmed box. */}
			<span className="min-w-0 flex-1 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1">{item.text}</span>
			<Tooltip content="Remove" side="top">
				<button
					type="button"
					// Keep the click from bubbling to the row's double-click/edit handler.
					onClick={event => {
						event.stopPropagation();
						onRemove();
					}}
					aria-label={`Remove queued message: ${item.text}`}
					className={cn(
						"shrink-0 flex h-5 w-5 items-center justify-center rounded-full",
						"text-muted-foreground hover:text-foreground hover:bg-hover",
						// Hover devices reveal × on row-hover; touch has no hover, so keep it persistently visible there.
						isTouch ? "opacity-100" : "opacity-0 group-hover/qrow:opacity-100 focus-visible:opacity-100",
						"transition-opacity duration-80 cursor-pointer outline-none",
						"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
					)}
				>
					<XIcon size={13} strokeWidth={2.5} />
				</button>
			</Tooltip>
		</motion.li>
	);
}

interface QueuedMessagesProps {
	entries: QueueEntry[];
	onEdit: (entry: QueueEntry) => void;
	onRemove: (entry: QueueEntry) => void;
}

/** The queued rows above the composer's textarea; the region's height collapses when the queue empties, and each row enters and exits on its own. */
export function QueuedMessages({ entries, onEdit, onRemove }: QueuedMessagesProps) {
	const reduceMotion = useReducedMotion() ?? false;
	const isTouch = useIsTouch();
	const [regionRef, regionHeight] = useRegionHeight();
	return (
		<AnimatePresence initial={false}>
			{entries.length > 0 && (
				<motion.div
					key="queue-row"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: regionHeight ?? 0, opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{ ...spring.moderate, bounce: 0 }}
					className="overflow-hidden"
				>
					{/* `data-im-queue` keeps a click on a row from refocusing the textarea. */}
					<ul ref={regionRef} aria-label="Queued messages" data-im-queue className="flex flex-col gap-1 pb-1">
						<AnimatePresence initial={false}>
							{entries.map((entry, index) => (
								<QueuedRow
									key={entry.item.id}
									item={entry.item}
									index={index}
									total={entries.length}
									reduceMotion={reduceMotion}
									isTouch={isTouch}
									onEdit={() => onEdit(entry)}
									onRemove={() => onRemove(entry)}
								/>
							))}
						</AnimatePresence>
					</ul>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
