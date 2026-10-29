/**
 * A message a routine sent into its Bot's conversation, as one row after Arc's Tool call (https://uiarc.dev/components/tool-call):
 * the routine, what started it, when, and how it went; a click opens in place what it sent, what that printed, what
 * started it, and its routine.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { taskOf } from "../../../src/shared/routine-message";
import type { Item } from "../../../src/shared/transcript";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { hashForBotRoutine } from "../../routing";
import { durationWords, messageStatus, pastRunWords } from "../../routines-model";
import { useMinute } from "../../use-minute";
import { HealthIcon, INSTANT, OPEN_SPRING, TaskIcon, TRIGGER_MARKS } from "./routine-marks";
import { CommandOutput, HEADING, TriggeredBy } from "./routine-open";

const CODE = "block rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words";

/** `copy` is the fold's copy button for what the routine sent. */
export function RoutineRunCard({ item, copy }: { item: Extract<Item, { kind: "routine" }>; copy: ReactNode }) {
	const foldId = useId();
	const reasonId = useId();
	const reduceMotion = useReducedMotion() ?? false;
	const now = useMinute();
	const [open, setOpen] = useState(false);
	const { message, shell } = item;
	const { botId, routine, at, triggeredBy, sent } = message;
	const task = taskOf(message);
	const { health, words } = messageStatus(item);
	const time = pastRunWords(at, now);
	const duration = sent.kind === "command" ? durationWords(sent.run.endedAt - sent.run.startedAt) : null;
	const reason = sent.kind === "command" && sent.run.phase === "failed" ? sent.run.error : null;
	const output = sent.kind === "command" ? ("output" in sent.run ? sent.run.output : "") : (shell?.output ?? "");
	const triggers = [...new Set(triggeredBy.map(({ kind }) => kind))];
	const name = [routine.name, `routine ${task.kind}`, words, time, duration && `took ${duration}`].filter(Boolean).join(", ");
	return (
		<div className="w-full overflow-hidden rounded-lg border border-border bg-card text-sm" data-item="routine">
			<button
				{...activityControl("transcript.routine-card")}
				type="button"
				aria-expanded={open}
				aria-controls={open ? foldId : undefined}
				aria-label={name}
				aria-describedby={reason ? reasonId : undefined}
				onClick={() => setOpen(!open)}
				className="flex min-h-9 w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-hover/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				<TaskIcon task={task} className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 truncate font-medium">{routine.name}</span>
				{triggers.length > 0 && (
					<span className="flex shrink-0 items-center gap-1">
						{triggers.map(kind => (
							<span key={kind} className="flex">
								{TRIGGER_MARKS[kind].logo}
							</span>
						))}
					</span>
				)}
				<span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
					<span className="tabular-nums @max-[440px]/conversation:hidden">{time}</span>
					{duration && <span className="tabular-nums">{duration}</span>}
					<span className="flex items-center gap-1.5">
						<HealthIcon health={health} label={words} />
						<span className={cn("@max-[440px]/conversation:sr-only", item.pending && !reduceMotion && "shimmer-text")}>{words}</span>
					</span>
					<ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
				</span>
			</button>
			{reason && (
				<p id={reasonId} className="-mt-1 truncate px-3 pb-1.5 pl-9 text-xs text-red-600 dark:text-red-400">
					{reason}
				</p>
			)}
			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						key="open"
						id={foldId}
						initial={{ height: 0 }}
						animate={{ height: "auto" }}
						exit={{ height: 0 }}
						transition={reduceMotion ? INSTANT : OPEN_SPRING}
						className="overflow-hidden"
					>
						<motion.div
							initial={reduceMotion ? false : { opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							transition={reduceMotion ? INSTANT : { duration: 0.2, delay: 0.08, ease: "easeOut" }}
							className="space-y-3 border-t border-border px-3 py-3"
						>
							<section className="space-y-1.5">
								<h4 className={HEADING}>{sent.kind === "command" ? "Command" : "Prompt"}</h4>
								{sent.kind === "command" ? (
									<code className={CODE}>$ {sent.command}</code>
								) : shell ? (
									<code className={CODE}>{sent.prompt}</code>
								) : (
									<p className="leading-relaxed whitespace-pre-wrap break-words">{sent.prompt}</p>
								)}
								{output.trim() !== "" && <CommandOutput output={output} />}
							</section>
							{triggeredBy.length > 0 && (
								<section className="space-y-1.5">
									<h4 className={HEADING}>Started by</h4>
									<TriggeredBy events={triggeredBy} />
								</section>
							)}
							<div className="flex items-center gap-2">
								<a href={hashForBotRoutine(botId, { kind: "open", id: routine.id })} className="text-xs font-medium underline-offset-2 hover:underline">
									Open routine
								</a>
								<span className="ml-auto flex">{copy}</span>
							</div>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
