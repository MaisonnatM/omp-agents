/** One row of a Workspace's routines card: its name, Run now, and switch; when it runs; what starts it and what it does, with its run strip; and, open, the rest in place. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconArrowRight, IconChevronDownSmall, IconPlay } from "central-icons";
import { type KeyboardEvent, type MouseEvent, useId, useState } from "react";
import { type Routine, type RoutineRun, runsHere } from "../../../src/routines";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { hashForRoutines } from "../../routing";
import {
	durationWords,
	nextRunWords,
	pastRunWords,
	runCountWords,
	runDuration,
	runHealth,
	runSlots,
	runWords,
	scheduledRunAt,
	schedulesWords,
	spentWords,
	taskWords,
} from "../../routines-model";
import { useAction } from "../../use-action";
import { useCountdownNow } from "../../use-minute";
import { useDashboardActions } from "../dashboard-context";
import { ToggleSwitch } from "../toggle-switch";
import { HEALTH_TICK, INSTANT, OPEN_SPRING, RunIcon, TaskIcon, TemplateMark, TRIGGER_MARKS } from "./routine-marks";
import { RoutineOpen } from "./routine-open";
import { RoutineFace } from "./routine-face";

/** A click on one of these inside a row works the control, and leaves the row as it is. */
const ROW_CONTROLS = "button, a, input, [role='switch'], [role='group']";

/** When the routine runs next, counting down each second once that is under an hour away. */
function NextRun({ routine }: { routine: Routine }) {
	const now = useCountdownNow(scheduledRunAt(routine));
	return <span className="tabular-nums">{nextRunWords(routine, now)}</span>;
}

/** What a tick's tooltip says of its run: how it went, when, how long its command took, and what started it. */
function TickDetail({ run, now }: { run: RoutineRun; now: number }) {
	const duration = runDuration(run);
	return (
		<div className="space-y-0.5">
			<p className="font-medium">{runWords(run)}</p>
			<p className="tabular-nums">
				{pastRunWords(run.at, now)}
				{duration !== null && `, took ${durationWords(duration)}`}
			</p>
			<p>{run.triggeredBy.length > 0 ? `Started by ${run.triggeredBy.map(({ title }) => title).join(", ")}` : "Started by its schedule or Run now"}</p>
		</div>
	);
}

/** Where `key` moves focus from `index` among `count` items laid out along `axis`; `null` for a key that moves none. */
export function stepIndex(key: string, index: number, count: number, axis: "x" | "y"): number | null {
	const [back, forth] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
	const next: Record<string, number> = { [back]: Math.max(0, index - 1), [forth]: Math.min(count - 1, index + 1), Home: 0, End: count - 1 };
	return next[key] ?? null;
}

interface RunStripProps {
	runs: RoutineRun[];
	/** The run the open row shows, which its tick marks; `null` while the row is closed. */
	picked: RoutineRun | null;
	now: number;
	onPick: (run: RoutineRun) => void;
}

/** The routine's last runs as ticks in fixed slots, latest last; one tab stop, the arrows moving between ticks. */
function RunStrip({ runs, picked, now, onPick }: RunStripProps) {
	const reduceMotion = useReducedMotion() ?? false;
	const slots = runSlots(runs);
	const filled = slots.filter(slot => slot !== null);
	const [focusedAt, setFocusedAt] = useState<number | null>(null);
	const focused = filled.find(({ at }) => at === focusedAt) ?? filled.at(-1);
	const move = (event: KeyboardEvent<HTMLDivElement>): void => {
		const index = focused ? stepIndex(event.key, filled.indexOf(focused), filled.length, "x") : null;
		if (index === null) return;
		event.preventDefault();
		const target = filled[index]!;
		setFocusedAt(target.at);
		event.currentTarget.querySelector<HTMLElement>(`[data-run-at="${target.at}"]`)?.focus();
	};
	return (
		<div role="group" aria-label={`Last runs: ${runCountWords(runs)}`} onKeyDown={move} className="flex h-5 shrink-0 items-center">
			<AnimatePresence initial={false} mode="popLayout">
				{slots.map((slot, index) =>
					slot === null ? (
						<motion.span key={`empty-${index}`} layout={!reduceMotion} aria-hidden className="flex h-5 w-[7px] items-center justify-center">
							<span className="h-3.5 w-[3px] rounded-full bg-muted-foreground/20" />
						</motion.span>
					) : (
						<motion.span
							key={slot.at}
							layout={!reduceMotion}
							initial={reduceMotion ? false : { x: 8, opacity: 0 }}
							animate={{ x: 0, opacity: 1 }}
							exit={reduceMotion ? { opacity: 0, transition: INSTANT } : { opacity: 0 }}
							transition={reduceMotion ? INSTANT : { duration: 0.24, ease: "easeOut" }}
							className="flex"
						>
							<Tooltip content={<TickDetail run={slot} now={now} />}>
								<button
									{...activityControl("routines.run")}
									type="button"
									data-run-at={slot.at}
									tabIndex={slot === focused ? 0 : -1}
									aria-label={`${runWords(slot)}, ${pastRunWords(slot.at, now)}`}
									aria-current={slot === picked || undefined}
									onFocus={() => setFocusedAt(slot.at)}
									onClick={() => onPick(slot)}
									className="flex h-5 w-[7px] items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className={cn("w-[3px] rounded-full", HEALTH_TICK[runHealth(slot)], slot === picked ? "h-5" : "h-3.5")} />
								</button>
							</Tooltip>
						</motion.span>
					),
				)}
			</AnimatePresence>
		</div>
	);
}

/** A row's third line for the screen reader, in place of its marks: what else starts it, and what it does. */
function marksSentence(routine: Routine): string {
	const triggers = routine.triggers.map(({ kind }) => TRIGGER_MARKS[kind].name);
	const does = routine.task.kind === "prompt" ? "Posts the instructions" : "Runs the command";
	return triggers.length > 0 ? `Starts on ${triggers.join(", ")}. ${does}:` : `${does}:`;
}

interface RoutineRowProps {
	routine: Routine;
	/** The routine this one was copied from, while it still exists; `null` for none. */
	template: Routine | null;
	/** Why the server holds the queued runs from starting, such as memory pressure; `null` when it does not. */
	held: string | null;
	open: boolean;
	connected: boolean;
	now: number;
}

export function RoutineRow({ routine, template, held, open, connected, now }: RoutineRowProps) {
	const detailsId = useId();
	const reduceMotion = useReducedMotion() ?? false;
	const { request, send } = useDashboardActions();
	const runNow = useAction(() => request({ t: "routine", change: { op: "run-now", id: routine.id } }), "Could not run the routine");
	const [pickedAt, setPickedAt] = useState<number | null>(null);
	const { id, workspace, name, machine, runs, task, triggers } = routine;
	const here = runsHere(routine);
	const latest = runs[0];
	const picked = runs.find(({ at }) => at === pickedAt) ?? latest;
	const spent = spentWords(runs);
	const health = latest && runHealth(latest);
	// A run the server holds queued, sending, or running takes no second Run now: it would claim another run beside it.
	const running = runNow.pending || health === "running" || health === "waiting";
	// The server holds this routine's queued run from starting while unattended work waits, which the row says instead of Running….
	const waitsFor = held !== null && runs.some(run => run.outcome.kind === "queued") ? held : null;
	const toggle = (): void => {
		// Opened afresh, the row shows the latest run until a tick picks another.
		if (!open) setPickedAt(null);
		location.hash = hashForRoutines(workspace, open ? { kind: "list" } : { kind: "open", id });
	};
	const clickRow = (event: MouseEvent<HTMLDivElement>): void => {
		if (!(event.target as Element).closest(ROW_CONTROLS)) toggle();
	};
	return (
		<li className="group/row relative">
			{/* The name's button is the row's control for the keyboard and the screen reader; a click elsewhere on the row is the pointer's shortcut to it. */}
			<div onClick={clickRow} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 hover:bg-hover/50">
				<RoutineFace id={id} className={cn("row-span-3 mt-0.5 size-9", !here && "opacity-60")} />
				<div className="flex min-h-7 items-center gap-2">
					<button
						type="button"
						data-routine-name
						aria-expanded={open}
						aria-controls={open ? detailsId : undefined}
						onClick={toggle}
						className="-ml-1.5 inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="truncate">{name}</span>
						<IconChevronDownSmall className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")} />
					</button>
					{routine.everyWorkspace && <TemplateMark />}
					<div className="ml-auto flex shrink-0 items-center gap-3">
						<Button
							variant="ghost"
							size="compact"
							leadingIcon={IconPlay}
							aria-label={`Run ${name} now`}
							disabled={!connected || running}
							loading={runNow.pending}
							onClick={() => runNow.run()}
							className={cn(
								"opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100 @max-[420px]/card:gap-0 @max-[420px]/card:px-1.5",
								(open || runNow.pending) && "opacity-100",
							)}
						>
							<span className="@max-[420px]/card:hidden">Run now</span>
						</Button>
						<ToggleSwitch
							aria-label={machine ? `Run ${name} on this computer instead of ${machine.name}` : `Enable ${name}`}
							checked={here}
							disabled={!connected}
							onCheckedChange={next => send({ t: "routine", change: { op: "enable", id, enabled: next } })}
						/>
					</div>
				</div>
				<div className={cn("flex min-w-0 items-center gap-3 text-xs text-muted-foreground", !here && "opacity-60")}>
					<p className="min-w-0 flex-1 truncate">
						{schedulesWords(routine)}
						{waitsFor !== null ? (
							<>
								{" · "}
								<span title={waitsFor}>Waiting for memory: {waitsFor}</span>
							</>
						) : running ? (
							<>
								{" · "}
								<span className={cn(!reduceMotion && "shimmer-text")}>Running…</span>
							</>
						) : (
							(!here || routine.schedules.length > 0) && (
								<>
									{" · "}
									<NextRun routine={routine} />
								</>
							)
						)}
					</p>
					{latest && (
						<p className="flex shrink-0 items-center gap-1.5">
							<RunIcon run={latest} />
							<span className="tabular-nums @max-[540px]/card:hidden">Last run {pastRunWords(latest.at, now)}</span>
						</p>
					)}
				</div>
				<div className={cn("flex min-w-0 items-center gap-3 text-xs text-muted-foreground", !here && "opacity-60")}>
					<p className="flex min-w-0 flex-1 items-center gap-1.5">
						{triggers.length > 0 && (
							<span aria-hidden className="flex shrink-0 items-center gap-1">
								{triggers.map(({ kind }) => (
									<span key={kind} className="flex">
										{TRIGGER_MARKS[kind].logo}
									</span>
								))}
								<IconArrowRight className="size-3" />
							</span>
						)}
						<span className="sr-only">{marksSentence(routine)}</span>
						<TaskIcon task={task} className="size-3.5 shrink-0" />
						<span className="min-w-0 truncate">{taskWords(task)}</span>
					</p>
					{spent && <span className="shrink-0 tabular-nums">{spent}</span>}
					<RunStrip
						runs={runs}
						picked={open ? (picked ?? null) : null}
						now={now}
						onPick={run => {
							if (!open) toggle();
							setPickedAt(run.at);
						}}
					/>
				</div>
			</div>
			{running && waitsFor === null && (
				<div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
					<div className={cn("h-full bg-primary/60", reduceMotion ? "w-full opacity-50" : "w-1/3 animate-[routine-progress_1.2s_ease-in-out_infinite]")} />
				</div>
			)}
			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						key="open"
						id={detailsId}
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
							className="px-4 pb-4"
						>
							<RoutineOpen routine={routine} template={template} run={picked} connected={connected} now={now} />
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</li>
	);
}
