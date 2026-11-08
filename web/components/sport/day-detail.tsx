/** The open day of the week: each workout with its demos, blocks, exercises, and loads, then the daily habits. */
import { Check, Play, Plus } from "lucide-react";
import type { DayKey } from "../../../src/shared/days";
import type { Exercise, Plan } from "../../../src/shared/sport";
import type { PlannedDay, PlannedExercise, PlannedWorkout } from "../../../src/sport-week";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { demosOf, dose, duration, loadSource, loadText, longDate, PLACE_LABEL, REMOVED_TEXT, shortDate, workoutDemos } from "../../sport-view";
import { DemoStrip } from "./demo-strip";

/** Opens the demo dialog on `demos`, at `at`, titled by what they belong to. */
export type OpenDemo = (title: string, demos: Exercise[], at: number) => void;

interface DayDetailProps {
	plan: Plan;
	day: PlannedDay;
	today: string;
	disabled: boolean;
	onDemo: OpenDemo;
	/** Opens the log form for `workout`, `null` for a free session. */
	onLog: (workout: PlannedWorkout | null) => void;
}

/** The days a gym session falls after work, which the day shows as « Le soir ». */
const EVENING: Record<DayKey, boolean> = { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false };

export function DayDetail({ plan, day, today, disabled, onDemo, onLog }: DayDetailProps) {
	const kicker = `${day.date === today ? "Aujourd'hui · " : ""}${longDate(day.date)}${day.deload ? " · semaine allégée" : ""}`;
	return (
		<div className="flex flex-col gap-4">
			{day.workouts.length === 0 ? (
				<section aria-label="Repos" className="rounded-xl border border-border p-5">
					<p className="text-xs text-muted-foreground first-letter:uppercase">{kicker}</p>
					<h2 className="text-xl font-semibold">Repos</h2>
					<p className="mt-1 text-sm text-muted-foreground">Rien de prévu ce jour.</p>
					<Button variant="tertiary" size="compact" leadingIcon={Plus} className="mt-3" disabled={disabled} onClick={() => onLog(null)}>Séance libre</Button>
				</section>
			) : (
				day.workouts.map(workout => <WorkoutCard key={workout.id} plan={plan} day={day} kicker={kicker} workout={workout} disabled={disabled} onDemo={onDemo} onLog={onLog} />)
			)}
			<Habits plan={plan} date={day.date} today={today} onDemo={onDemo} />
		</div>
	);
}

function WorkoutCard({ plan, day, kicker, workout, disabled, onDemo, onLog }: Omit<DayDetailProps, "today"> & { kicker: string; workout: PlannedWorkout }) {
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
						{workout.place === "gym" && EVENING[day.weekday] && <Badge size="compact">Le soir</Badge>}
						{workout.optional && <Badge size="compact">option</Badge>}
						{log?.status === "done" && <Badge variant="dot" size="compact" color="green">Faite</Badge>}
						{log?.status === "skipped" && <Badge variant="dot" size="compact" color="gray">Pas faite</Badge>}
					</div>
				</div>
				{log ? (
					<Button variant="tertiary" size="compact" disabled={disabled} onClick={() => onLog(workout)}>Modifier…</Button>
				) : (
					<Button size="compact" leadingIcon={Check} disabled={disabled} onClick={() => onLog(workout)} {...activityControl("sport.log.open")}>Fait…</Button>
				)}
			</header>
			<DemoStrip demos={demos} onOpen={at => onDemo(workout.name, demos, at)} />
			{blocks.map(({ title, rows }, index) => (
				<div key={`${title}-${index}`} className="flex flex-col gap-1">
					<h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
					<ul className="divide-y divide-border">
						{rows.map(({ item, at }, row) => <ExerciseRow key={`${item.exercise.key}-${row}`} item={item} onDemo={at === null ? null : () => onDemo(workout.name, demos, at)} />)}
					</ul>
				</div>
			))}
		</section>
	);
}

function ExerciseRow({ item: { exercise, load, removed }, onDemo }: { item: PlannedExercise; onDemo: (() => void) | null }) {
	const kg = loadText(exercise, load);
	const source = removed ? REMOVED_TEXT : loadSource(load);
	const side = [dose(exercise), exercise.note].filter(Boolean).join(" · ");
	return (
		<li className="flex flex-col gap-0.5 py-2 text-sm @md/sport:flex-row @md/sport:items-start @md/sport:justify-between @md/sport:gap-4">
			<div className="min-w-0">
				{onDemo && !removed ? (
					<button type="button" onClick={onDemo} {...activityControl("sport.demo.open")} className="inline-flex items-center gap-1 rounded-sm text-left underline decoration-dotted underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
						{exercise.name}
						<Play aria-label="démo" className="size-3 fill-current text-muted-foreground" />
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
		</li>
	);
}

function Habits({ plan, date, today, onDemo }: { plan: Plan; date: string; today: string; onDemo: OpenDemo }) {
	if (plan.habits.length === 0) return null;
	return (
		<section aria-label="Chaque jour" className="rounded-xl border border-border p-5">
			<h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Chaque jour · {date === today ? "aujourd'hui" : shortDate(date)}</h2>
			<ul className="mt-2 divide-y divide-border">
				{plan.habits.map(habit => {
					const routine = plan.routines.find(({ id }) => id === habit.routine) ?? null;
					const demos = routine ? demosOf(plan, routine.items) : [];
					return (
						<li key={habit.label} className="flex items-center justify-between gap-3 py-2 text-sm">
							<span>{habit.label}</span>
							{routine && demos.length > 0 && (
								<Button variant="ghost" size="compact" leadingIcon={Play} onClick={() => onDemo(routine.name, demos, 0)} {...activityControl("sport.demo.open")}>Démos</Button>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
