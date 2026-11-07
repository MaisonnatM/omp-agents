/** The Sport page: the plan's week, the journal of logged sessions, and the progress charts, under one header. */
import { Plus, Scale } from "lucide-react";
import { useState } from "react";
import { addDays, localDay } from "../../../src/shared/days";
import type { Exercise, SportChange, SportState } from "../../../src/shared/sport";
import { dayPlan, phaseOn } from "../../../src/sport-week";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import { hashForSport, type SportRoute } from "../../routing";
import { useShortcuts } from "../../shortcuts";
import { bodyweightOf, phaseLabel } from "../../sport-view";
import { PageFrame } from "../list-page";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { DemoDialog } from "./demo-dialog";
import { JournalTab } from "./journal";
import { LogForm, type LogTarget, WeighForm } from "./log-form";
import { type Saved, SummaryDialog } from "./log-summary";
import { SPORT_TABS } from "./nav";
import { ProgressTab } from "./progress";
import { WeekTab } from "./week";

interface SportPageProps {
	/** `null` until the dashboard's first state arrives. */
	state: SportState | null;
	route: SportRoute;
	disabled: boolean;
	onChange: (change: SportChange) => Promise<void>;
}

const TAB_CONTROL = { week: "sport.tab.week", journal: "sport.tab.journal", progress: "sport.tab.progress" } as const;

/** What to ask the personal agent for when there is no plan yet. */
const ASK_FOR_PLAN = "Crée-moi un plan d'escalade de 4 semaines : poutre, bloc et routine hanche, avec mes charges de départ.";

export function SportPage({ state, route, disabled, onChange }: SportPageProps) {
	const [demo, setDemo] = useState<{ title: string; demos: Exercise[]; at: number } | null>(null);
	const [target, setTarget] = useState<LogTarget | null>(null);
	const [saved, setSaved] = useState<Saved | null>(null);
	const [weighing, setWeighing] = useState(false);
	const today = localDay();
	const selected = route.tab === "week" ? (route.day ?? today) : today;
	const plan = state?.plan ?? null;
	const dialogOpen = demo !== null || target !== null || saved !== null || weighing;
	const stepDay = (by: -1 | 1) => {
		location.hash = hashForSport({ tab: "week", day: addDays(selected, by) });
	};
	useShortcuts(route.tab === "week" && plan && !dialogOpen ? { sportPreviousDay: () => stepDay(-1), sportNextDay: () => stepDay(1) } : {});
	if (state === null) {
		return (
			<PageFrame title="Sport" meta="Ton plan d'entraînement">
				<p className="px-6 py-6 text-sm text-muted-foreground">Chargement du plan…</p>
			</PageFrame>
		);
	}
	const phase = plan && phaseOn(plan, selected);
	const bodyweight = bodyweightOf(state);
	const logFor = (date: string, workout: LogTarget["workout"]) => setTarget({ date, workout, log: workout?.log ?? null });
	return (
		<PageFrame
			title="Sport"
			meta={plan === null ? "Aucun plan" : phase ? phaseLabel(phase, selected) : plan.title}
			actions={
				<>
					<Tooltip content="Noter une séance hors du plan">
						<Button variant="ghost" size="compact" leadingIcon={Plus} disabled={disabled} onClick={() => logFor(selected, null)} {...activityControl("sport.log.free")}>
							<span className="max-[699px]:sr-only">Séance libre</span>
						</Button>
					</Tooltip>
					{bodyweight && (
						<Tooltip content="Noter ton poids du jour">
							<Button variant="ghost" size="compact" leadingIcon={Scale} disabled={disabled} onClick={() => setWeighing(true)} {...activityControl("sport.weigh.open")}>
								<span className="max-[699px]:sr-only">Pesée</span>
							</Button>
						</Tooltip>
					)}
					<SegmentedTabs
						value={route.tab}
						onValueChange={tab => {
							const next = SPORT_TABS.find(({ route: { tab: name } }) => name === tab);
							if (next) location.hash = hashForSport(next.route);
						}}
						activationMode="manual"
					>
						<SegmentedTabsList aria-label="Vue">
							{SPORT_TABS.map(({ route: { tab }, name }) => (
								<SegmentedTab key={tab} value={tab} {...activityControl(TAB_CONTROL[tab])}>
									{name}
								</SegmentedTab>
							))}
						</SegmentedTabsList>
					</SegmentedTabs>
				</>
			}
		>
			{route.tab === "week" &&
				(plan === null ? (
					<div className="mx-auto flex max-w-xl flex-col gap-2 px-6 py-10 text-sm">
						<h2 className="text-base font-semibold">Pas encore de plan</h2>
						<p className="text-muted-foreground">Ton agent personnel écrit le plan. Demande-lui par exemple :</p>
						<blockquote className="rounded-lg border border-border bg-card px-4 py-3">« {ASK_FOR_PLAN} »</blockquote>
						<p className="text-muted-foreground">La semaine s'affiche ici dès qu'il l'enregistre. En attendant, + Séance libre note une séance au journal.</p>
					</div>
				) : (
					<WeekTab
						state={state}
						plan={plan}
						selected={selected}
						today={today}
						disabled={disabled}
						onDemo={(title, demos, at) => setDemo({ title, demos, at })}
						onLog={logFor}
					/>
				))}
			{route.tab === "journal" && (
				<JournalTab
					state={state}
					open={route.open}
					disabled={disabled}
					onChange={onChange}
					onEdit={log => setTarget({ date: log.date, workout: dayPlan(state, log.date).workouts.find(({ id }) => id === log.workout) ?? null, log })}
				/>
			)}
			{route.tab === "progress" && <ProgressTab state={state} today={today} />}
			{demo && <DemoDialog title={demo.title} demos={demo.demos} at={demo.at} onAt={at => setDemo({ ...demo, at })} onClose={() => setDemo(null)} />}
			{target && (
				<LogForm
					key={`${target.date}-${target.workout?.id ?? "libre"}-${target.log?.id ?? "new"}`}
					state={state}
					target={target}
					disabled={disabled}
					onChange={onChange}
					onSaved={next => {
						setTarget(null);
						setSaved(next);
					}}
					onClose={() => setTarget(null)}
				/>
			)}
			{saved && <SummaryDialog saved={saved} onClose={() => setSaved(null)} />}
			{weighing && bodyweight && <WeighForm state={state} metric={bodyweight} today={today} disabled={disabled} onChange={onChange} onClose={() => setWeighing(false)} />}
		</PageFrame>
	);
}
