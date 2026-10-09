import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { promptLabel } from "../../src/shared/prompt-files";
import type { MessageQueue, WithdrawnMessage } from "../../src/shared/sessions";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsTouch, useRegionHeight } from "@/components/ui/input-message";
import { fontWeights } from "@/lib/font-weight";
import { type IconName, useIcon } from "@/lib/icon-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { shortcutLabels, shortcutsFor } from "../shortcuts";

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
	withdrawn: { reqId: number; messages: WithdrawnMessage[] } | null;
	dequeue: (reqId: number, queue: keyof MessageQueue, text: string) => void;
	interrupt: (reqId: number) => void;
	restore: (messages: WithdrawnMessage[]) => void;
}

/** The rows waiting on the running turn; `take` pulls one out before the agent gets it, and `interrupt` stops the turn and pulls out all of them. */
export function useQueue({ waiting, withdrawn, dequeue, interrupt, restore }: QueueOptions) {
	const restoring = useRef(new Set<number>());
	const nextId = useRef(0);
	const queued = queuedEntries(waiting);
	const take = (entry: QueueEntry | undefined, edit: boolean): boolean | void => {
		if (!entry) return false;
		const id = ++nextId.current;
		if (edit) restoring.current.add(id);
		dequeue(id, entry.queue, entry.item.text);
	};
	const stop = (): void => {
		const id = ++nextId.current;
		restoring.current.add(id);
		interrupt(id);
	};
	useEffect(() => {
		if (withdrawn && restoring.current.delete(withdrawn.reqId)) restore(withdrawn.messages);
	}, [withdrawn]);
	return { queued, take, interrupt: stop };
}

interface RowAction {
	icon: IconName;
	label: string;
	shortcut?: readonly string[];
	run: () => void;
}

function RowActionButton({ action, text, isTouch }: { action: RowAction; text: string; isTouch: boolean }) {
	const Icon = useIcon(action.icon);
	return (
		<Tooltip content={action.label} shortcut={action.shortcut} side="top">
			<button
				type="button"
				onClick={event => {
					event.stopPropagation();
					action.run();
				}}
				onDoubleClick={event => event.stopPropagation()}
				aria-label={`${action.label}: ${text}`}
				className={cn(
					"shrink-0 flex h-5 w-5 items-center justify-center rounded-full",
					"text-muted-foreground hover:text-foreground hover:bg-hover",
					isTouch ? "opacity-100" : "opacity-0 group-hover/qrow:opacity-100 group-focus-within/qrow:opacity-100 focus-visible:opacity-100",
					"transition-opacity duration-80 cursor-pointer outline-none",
					"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
				)}
			>
				<Icon size={13} strokeWidth={2.5} />
			</button>
		</Tooltip>
	);
}

interface QueuedRowProps {
	item: QueuedItem;
	index: number;
	total: number;
	reduceMotion: boolean;
	isTouch: boolean;
	onSendNow: () => void;
	onEdit: () => void;
	onRemove: () => void;
}

/** A message waiting on the running turn: a recessed row that reads as "staged, not live", led by its tag. */
function QueuedRow({ item, index, total, reduceMotion, isTouch, onSendNow, onEdit, onRemove }: QueuedRowProps) {
	const compactStep = useSize().variant === "compact";
	const kind = `${item.tag.toLowerCase()} `;
	const label = promptLabel(item.text);
	const actions: RowAction[] = [
		{ icon: "arrow-up", label: "Send now", shortcut: shortcutLabels("steer"), run: onSendNow },
		{ icon: "pencil", label: "Edit", shortcut: ["Enter"], run: onEdit },
		{ icon: "x", label: "Remove", run: onRemove },
	];

	return (
		<motion.li
			layout
			// Enter: spring-fast chip category. Exit slightly faster (0.06s linear). Reduced-motion drops the scale.
			initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: spring.fast.exit }}
			transition={spring.fast}
			aria-label={`Queued ${kind}message ${index + 1} of ${total}: ${label}`}
			tabIndex={0}
			onDoubleClick={onEdit}
			onKeyDown={event => {
				if (event.target !== event.currentTarget) return;
				if (shortcutsFor(event).some(({ id }) => id === "steer")) {
					event.preventDefault();
					onSendNow();
				} else if (event.key === "Enter" || event.key === "F2") {
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
			<span className="min-w-0 flex-1 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1">{label}</span>
			<span className="flex shrink-0 items-center gap-0.5">
				{actions.map(action => (
					<RowActionButton key={action.icon} action={action} text={label} isTouch={isTouch} />
				))}
			</span>
		</motion.li>
	);
}

interface QueuedMessagesProps {
	entries: QueueEntry[];
	onSendNow: (entry: QueueEntry) => void;
	onEdit: (entry: QueueEntry) => void;
	onRemove: (entry: QueueEntry) => void;
}

/** The queued rows above the composer's text field; the region's height collapses when the queue empties, and each row enters and exits on its own. */
export function QueuedMessages({ entries, onSendNow, onEdit, onRemove }: QueuedMessagesProps) {
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
					{/* `data-im-queue` keeps a click on a row from refocusing the text field. */}
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
									onSendNow={() => onSendNow(entry)}
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
