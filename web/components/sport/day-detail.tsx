/** The open day of the week: each workout with its demos, blocks, exercises, and loads, then the daily habits with their routines' checklists. */
import { IconCheckmark1, IconPlay, IconPlusLarge, IconStopwatch } from "central-icons";
import type { Exercise, Plan, Routine, RoutineCheck } from "../../../src/shared/sport";
import type { PlannedDay, PlannedExercise, PlannedWorkout } from "../../../src/sport-week";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { demosOf, dose, duration, loadSource, loadText, longDate, opening, PLACE_LABEL, REMOVED_TEXT, shortDate, workoutDemos } from "../../sport-view";
import { DemoStrip } from "./demo-strip";

/** Opens the demo dialog on `demos`, at `at`, titled by what they belong to. */
export type OpenDemo = (title: string, demos: Exercise[], at: number) => void;

/** The day and routine whose checklist a timer run ticks. */
export interface TimerTarget {
	date: string;
	routine: string;
}

/** Opens the timer on `items` under `name`, ticking them in `target`'s checklist, or nothing when `null`; called in the click, which lets the timer play sound. */
export type OpenTimer = (name: string, items: Exercise[], target: TimerTarget | null) => void;

interface DayDetailProps {
	plan: Plan;
	day: PlannedDay;
	today: string;
	disabled: boolean;
	/** Every day's ticks of the routines; the day's own show. */
	checks: RoutineCheck[];
	onDemo: OpenDemo;
	onTimer: OpenTimer;
	/** Opens the log form for `workout`, `null` for a free session. */
	onLog: (workout: PlannedWorkout | null) => void;
	/** Saves a day's ticks of one routine. */
	onCheck: (check: RoutineCheck) => void;
}

export function DayDetail({ plan, day, today, disabled, checks, onDemo, onTimer, onLog, onCheck }: DayDetailProps) {
	const kicker = `${day.date === today ? "Aujourd'hui · " : ""}${longDate(day.date)}${day.deload ? " · semaine allégée" : ""}`;
	return (
		<div className="flex flex-col gap-4">
			{day.workouts.length === 0 ? (
				<section aria-label="Repos" className="rounded-xl border border-border p-5">
					<p className="text-xs text-muted-foreground first-letter:uppercase">{kicker}</p>
					<h2 className="text-xl font-semibold">Repos</h2>
					<p className="mt-1 text-sm text-muted-foreground">Rien de prévu ce jour.</p>
					<Button variant="tertiary" size="compact" leadingIcon={IconPlusLarge} className="mt-3" disabled={disabled} onClick={() => onLog(null)} {...activityControl("sport.log.free")}>Séance libre</Button>
				</section>
			) : (
				day.workouts.map(workout => <WorkoutCard key={workout.id} plan={plan} kicker={kicker} workout={workout} disabled={disabled} onDemo={onDemo} onTimer={onTimer} onLog={onLog} />)
			)}
			<Habits plan={plan} date={day.date} today={today} disabled={disabled} checks={checks} onDemo={onDemo} onTimer={onTimer} onCheck={onCheck} />
		</div>
	);
}

function WorkoutCard({ plan, kicker, workout, disabled, onDemo, onTimer, onLog }: Omit<DayDetailProps, "today" | "day" | "checks" | "onCheck"> & { kicker: string; workout: PlannedWorkout }) {
	const { demos, blocks } = workoutDemos(plan, workout);
	const log = workout.log;
	return (
		<section aria-label={workout.name} className="flex flex-col gap-4 rounded-xl border border-border p-5">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground first-letter:uppercase">{kicker}</p>
					<h2 className="text-xl font-semibold">{workout.name}</h2>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						<Badge size="compact">{PLACE_LABEL[workout.place]}</Badge>
						<Badge size="compact">{duration(workout.minutes)}</Badge>
						{workout.optional && <Badge size="compact">option</Badge>}
						{log?.status === "done" && <Badge variant="dot" size="compact" color="green">Faite</Badge>}
						{log?.status === "skipped" && <Badge variant="dot" size="compact" color="gray">Pas faite</Badge>}
					</div>
				</div>
				{log ? (
					<Button variant="tertiary" size="compact" disabled={disabled} onClick={() => onLog(workout)} {...activityControl("sport.day.edit")}>Modifier…</Button>
				) : (
					<Button size="compact" leadingIcon={IconCheckmark1} disabled={disabled} onClick={() => onLog(workout)} {...activityControl("sport.log.open")}>Fait…</Button>
				)}
			</header>
			<DemoStrip demos={demos} onOpen={at => onDemo(workout.name, demos, at)} />
			{blocks.map(({ title, rows }, index) => (
				<div key={`${title}-${index}`} className="flex flex-col gap-1">
					<h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
					<ul className="divide-y divide-border">
						{rows.map(({ item, at }, row) => {
							// An exercise that opens as others, such as « Routine hanche », runs them in the timer, with no checklist to tick.
							const items = item.exercise.opensAs.length > 0 && !item.removed ? opening(plan, item.exercise) : [];
							return (
								<ExerciseRow
									key={`${item.exercise.key}-${row}`}
									item={item}
									onDemo={at === null ? null : () => onDemo(workout.name, demos, at)}
									onTimer={items.length === 0 ? null : () => onTimer(item.exercise.name, items, null)}
								/>
							);
						})}
					</ul>
				</div>
			))}
		</section>
	);
}

function ExerciseRow({ item: { exercise, load, removed }, onDemo, onTimer }: { item: PlannedExercise; onDemo: (() => void) | null; onTimer: (() => void) | null }) {
	const kg = loadText(exercise, load);
	const source = removed ? REMOVED_TEXT : loadSource(load);
	const side = [dose(exercise), exercise.note].filter(Boolean).join(" · ");
	return (
		<li className="flex items-start gap-3 py-2 text-sm">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5 @md/sport:flex-row @md/sport:items-start @md/sport:justify-between @md/sport:gap-4">
				<div className="min-w-0">
					{onDemo && !removed ? (
						<button type="button" onClick={onDemo} {...activityControl("sport.demo.open")} className="inline-flex items-center gap-1 rounded-sm text-left underline decoration-dotted underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
							{exercise.name}
							<IconPlay aria-hidden={false} aria-label="démo" className="size-3 icon-shapes:fill-current text-muted-foreground" />
						</button>
					) : (
						<span className={removed ? "text-muted-foreground line-through" : undefined}>{exercise.name}</span>
					)}
					{source && <p className="text-xs text-muted-foreground">{source}</p>}
				</div>
				<div className={cn("min-w-0 @md/sport:max-w-[50%] @md/sport:text-right", removed && "text-muted-foreground line-through")}>
					{side && <p className="text-muted-foreground">{side}</p>}
					{kg && !removed && <p className="font-medium tabular-nums">{kg}</p>}
				</div>
			</div>
			{onTimer && (
				<Button variant="secondary" size="compact" leadingIcon={IconStopwatch} className="shrink-0" onClick={onTimer} {...activityControl("sport.timer.open")}>
					Lancer
				</Button>
			)}
		</li>
	);
}

interface HabitsProps {
	plan: Plan;
	date: string;
	today: string;
	disabled: boolean;
	checks: RoutineCheck[];
	onDemo: OpenDemo;
	onTimer: OpenTimer;
	onCheck: (check: RoutineCheck) => void;
}

function Habits({ plan, date, today, disabled, checks, onDemo, onTimer, onCheck }: HabitsProps) {
	if (plan.habits.length === 0) return null;
	return (
		<section aria-label="Chaque jour" className="rounded-xl border border-border p-5">
			<h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Chaque jour · {date === today ? "aujourd'hui" : shortDate(date)}</h2>
			<ul className="mt-2 divide-y divide-border">
				{plan.habits.map(habit => {
					const routine = plan.routines.find(({ id }) => id === habit.routine) ?? null;
					if (routine === null) return <li key={habit.label} className="py-2 text-sm">{habit.label}</li>;
					const saved = checks.find(check => check.date === date && check.routine === routine.id)?.items ?? [];
					return <RoutineHabit key={habit.label} plan={plan} label={habit.label} routine={routine} ticked={routine.items.map(({ key }) => key).filter(key => saved.includes(key))} disabled={disabled} onDemo={onDemo} onTimer={() => onTimer(routine.name, routine.items, { date, routine: routine.id })} onTick={items => onCheck({ date, routine: routine.id, items })} />;
				})}
			</ul>
		</section>
	);
}

interface RoutineHabitProps {
	plan: Plan;
	label: string;
	routine: Routine;
	/** The keys of the routine's items ticked on the day, in the routine's order; a key the plan no longer holds is left out. */
	ticked: string[];
	disabled: boolean;
	onDemo: OpenDemo;
	/** Opens the timer on the routine. */
	onTimer: () => void;
	onTick: (items: string[]) => void;
}

/** A habit that follows a routine: its label with how many items are ticked, then the routine's items as a checklist. */
function RoutineHabit({ plan, label, routine, ticked, disabled, onDemo, onTimer, onTick }: RoutineHabitProps) {
	const demos = demosOf(plan, routine.items);
	return (
		<li className="flex flex-col gap-1 py-2 text-sm">
			{/* Narrow, the count and buttons wrap under the label rather than squeezing it. */}
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<span className="min-w-0 flex-[1_1_16rem]">{label}</span>
				<span className="flex shrink-0 items-center gap-2">
					{routine.items.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{ticked.length} / {routine.items.length}</span>}
					{demos.length > 0 && <Button variant="ghost" size="compact" leadingIcon={IconPlay} onClick={() => onDemo(routine.name, demos, 0)} {...activityControl("sport.demo.open")}>Démos</Button>}
					{routine.items.length > 0 && (
						<Button variant="secondary" size="compact" leadingIcon={IconStopwatch} disabled={disabled} onClick={onTimer} {...activityControl("sport.timer.open")}>
							Lancer
						</Button>
					)}
				</span>
			</div>
			{routine.items.length > 0 && (
				<ul aria-label={routine.name} className="flex flex-col">
					{routine.items.map(exercise => {
						const done = ticked.includes(exercise.key);
						const own = demosOf(plan, [exercise])[0];
						const at = own ? demos.indexOf(own) : -1;
						return (
							<CheckRow
								key={exercise.key}
								exercise={exercise}
								done={done}
								disabled={disabled}
								onDemo={at === -1 ? null : () => onDemo(routine.name, demos, at)}
								onToggle={() => onTick(done ? ticked.filter(key => key !== exercise.key) : [...ticked, exercise.key])}
							/>
						);
					})}
				</ul>
			)}
		</li>
	);
}

function CheckRow({ exercise, done, disabled, onDemo, onToggle }: { exercise: Exercise; done: boolean; disabled: boolean; onDemo: (() => void) | null; onToggle: () => void }) {
	const side = [dose(exercise), exercise.note].filter(Boolean).join(" · ");
	return (
		<li className="flex items-start gap-3 py-1.5">
			<button
				type="button"
				role="checkbox"
				aria-checked={done}
				aria-label={`Fait, ${exercise.name}`}
				disabled={disabled}
				onClick={onToggle}
				className={cn("mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", done ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-accent")}
			>
				{done && <IconCheckmark1 className="size-3.5" />}
			</button>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5 @md/sport:flex-row @md/sport:items-start @md/sport:justify-between @md/sport:gap-4">
				{onDemo ? (
					<button type="button" onClick={onDemo} {...activityControl("sport.demo.open")} className={cn("inline-flex items-center gap-1 self-start rounded-sm text-left underline decoration-dotted underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring", done && "text-muted-foreground")}>
						{exercise.name}
						<IconPlay aria-hidden={false} aria-label="démo" className="size-3 icon-shapes:fill-current text-muted-foreground" />
					</button>
				) : (
					<span className={cn(done && "text-muted-foreground")}>{exercise.name}</span>
				)}
				{side && <p className="min-w-0 text-muted-foreground @md/sport:max-w-[50%] @md/sport:text-right">{side}</p>}
			</div>
		</li>
	);
}
