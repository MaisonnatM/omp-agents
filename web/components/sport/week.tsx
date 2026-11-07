/** The Sport page's week: the day list of this week and the next, beside the open day, under a pain flag that holds today. */
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { addDays, mondayOf } from "../../../src/shared/days";
import type { Plan, SportState } from "../../../src/shared/sport";
import { adherence, painFlags, type PlannedWorkout, weekPlan } from "../../../src/sport-week";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { hashForSport } from "../../routing";
import { daySummary, dayOfMonth, KIND_COLOR, phaseLabel, weekdayShort, weekTitle } from "../../sport-view";
import { DayDetail, type OpenDemo } from "./day-detail";
import { PainBanner } from "./pain-banner";

interface WeekTabProps {
	state: SportState;
	plan: Plan;
	/** The open day. */
	selected: string;
	today: string;
	disabled: boolean;
	onDemo: OpenDemo;
	onLog: (date: string, workout: PlannedWorkout | null) => void;
}

/** The id of a day's row in the list, which the arrow keys focus. */
export const dayRowId = (date: string): string => `sport-day-${date}`;

export function WeekTab({ state, plan, selected, today, disabled, onDemo, onLog }: WeekTabProps) {
	const monday = mondayOf(selected);
	const weeks = [weekPlan(state, monday), weekPlan(state, addDays(monday, 7))];
	const day = weeks[0]!.find(({ date }) => date === selected)!;
	const { planned, done } = adherence(state, monday, addDays(monday, 6));
	const flag = painFlags(state, today).at(-1) ?? null;
	const pending = day.workouts.find(({ log, optional }) => log === null && !optional) ?? null;
	useEffect(() => {
		document.getElementById(dayRowId(selected))?.scrollIntoView({ block: "nearest" });
	}, [selected]);
	const step = (days: number) => hashForSport({ tab: "week", day: addDays(selected, days) });
	return (
		<div className="flex h-full min-h-0 flex-col min-[700px]:flex-row">
			<nav aria-label="Jours" className="min-h-0 shrink-0 basis-[40%] overflow-y-auto border-b border-border px-3 py-3 min-[700px]:basis-auto min-[700px]:w-80 min-[700px]:border-r min-[700px]:border-b-0">
				<div className="flex items-center gap-1 px-1">
					<Tooltip content="Semaine précédente">
						<Button variant="ghost" size="icon-compact" aria-label="Semaine précédente" asChild>
							<a href={step(-7)} {...activityControl("sport.week.step")}><ChevronLeft /></a>
						</Button>
					</Tooltip>
					<h2 className="min-w-0 flex-1 truncate text-center text-sm font-medium">{weekTitle(monday)}</h2>
					<Tooltip content="Semaine suivante">
						<Button variant="ghost" size="icon-compact" aria-label="Semaine suivante" asChild>
							<a href={step(7)} {...activityControl("sport.week.step")}><ChevronRight /></a>
						</Button>
					</Tooltip>
				</div>
				{planned > 0 && (
					<div className="mt-2 flex items-center gap-2 px-1">
						<span aria-hidden className="flex flex-1 gap-0.5">
							{Array.from({ length: planned }, (_, index) => <span key={index} className={cn("h-1.5 flex-1 rounded-full", index < done ? "bg-success" : "bg-muted")} />)}
						</span>
						<span className="text-xs text-muted-foreground tabular-nums">{done} sur {planned} faites</span>
					</div>
				)}
				{mondayOf(today) !== monday && (
					<a href={hashForSport({ tab: "week", day: null })} className="mt-2 block px-1 text-xs text-primary underline-offset-2 hover:underline">Revenir à aujourd'hui</a>
				)}
				{weeks.map(week => (
					<div key={week[0]!.date} className="mt-3">
						<h3 className="px-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{week[0]!.phase ? phaseLabel(week[0]!.phase, week[0]!.date) : "Hors plan"}</h3>
						<ul className="flex flex-col gap-0.5">
							{week.map(planned => {
								const summary = daySummary(planned);
								const open = planned.date === selected;
								return (
									<li key={planned.date}>
										<a id={dayRowId(planned.date)} href={hashForSport({ tab: "week", day: planned.date })} aria-current={open ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-2 py-1.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", open && "bg-accent")}>
											<span aria-hidden className="h-8 w-1 shrink-0 rounded-full" style={{ background: summary.kind ? KIND_COLOR[summary.kind] : "var(--border)" }} />
											<span className="w-8 shrink-0 text-center">
												<span className={cn("block text-[11px] text-muted-foreground uppercase", planned.date === today && "font-semibold text-primary")}>{weekdayShort(planned.date)}</span>
												<span className="block text-sm font-medium tabular-nums">{dayOfMonth(planned.date)}</span>
											</span>
											<span className="min-w-0 flex-1">
												<span className={cn("block truncate text-sm", summary.kind ? "font-medium" : "text-muted-foreground")}>{summary.title}</span>
												{summary.detail && <span className="block truncate text-xs text-muted-foreground">{summary.detail}</span>}
											</span>
											{summary.done && <Check aria-label="faite" className="size-4 shrink-0 text-success" />}
										</a>
									</li>
								);
							})}
						</ul>
					</div>
				))}
			</nav>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 pb-20 min-[700px]:px-6 min-[700px]:pb-6">
					{flag && <PainBanner flag={flag} today={today} />}
					<DayDetail plan={plan} day={day} today={today} disabled={disabled} onDemo={onDemo} onLog={workout => onLog(day.date, workout)} />
				</div>
			</div>
			{pending && (
				<Button className="fixed inset-x-4 bottom-4 z-20 min-[700px]:hidden" leadingIcon={Check} disabled={disabled} onClick={() => onLog(day.date, pending)} {...activityControl("sport.log.open")}>
					Séance faite…
				</Button>
			)}
		</div>
	);
}
