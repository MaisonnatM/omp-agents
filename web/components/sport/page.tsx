/** The Sport page: the plan's week, the journal of logged sessions, and the progress charts, under one header. */
import { Plus, Scale } from "lucide-react";
import { type ReactNode, useState } from "react";
import { addDays, localDay } from "../../../src/shared/days";
import type { Exercise, SportChange, SportState } from "../../../src/shared/sport";
import { dayPlan, phaseOn } from "../../../src/sport-week";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import { hashForSport, type SportRoute } from "../../routing";
import { useShortcuts } from "../../shortcuts";
import { bodyweightOf, type LogTarget, phaseLabel, type Saved } from "../../sport-view";
import { PageFrame } from "../list-page";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { DemoDialog } from "./demo-dialog";
import { JournalTab } from "./journal";
import { LogForm, WeighForm } from "./log-form";
import { SummaryDialog } from "./log-summary";
import { SPORT_TABS } from "./nav";
import { ProgressTab } from "./progress";
import { WeekTab } from "./week";

interface SportPageProps {
	/** `null` until the dashboard's first state arrives. */
	state: SportState | null;
	route: SportRoute;
	disabled: boolean;
	onChange: (changes: SportChange[]) => Promise<void>;
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
			<SportRoot>
				<PageFrame title="Sport" meta="Ton plan d'entraînement">
					<p className="px-6 py-6 text-sm text-muted-foreground">Chargement du plan…</p>
				</PageFrame>
			</SportRoot>
		);
	}
	const phase = plan && phaseOn(plan, selected);
	const bodyweight = bodyweightOf(state);
	const logFor = (date: string, workout: LogTarget["workout"]) => setTarget({ date, workout, log: workout?.log ?? null });
	return (
		<SportRoot>
			<PageFrame
				title="Sport"
				meta={plan === null ? "Aucun plan" : phase ? phaseLabel(phase, selected) : plan.title}
				actions={
					<>
						<Tooltip content="Noter une séance hors du plan">
							<Button variant="ghost" size="compact" leadingIcon={Plus} disabled={disabled} onClick={() => logFor(selected, null)} {...activityControl("sport.log.free")}>
								<span className="sr-only @3xl/sport:not-sr-only">Séance libre</span>
							</Button>
						</Tooltip>
						{bodyweight && (
							<Tooltip content="Noter ton poids du jour">
								<Button variant="ghost" size="compact" leadingIcon={Scale} disabled={disabled} onClick={() => setWeighing(true)} {...activityControl("sport.weigh.open")}>
									<span className="sr-only @3xl/sport:not-sr-only">Pesée</span>
								</Button>
							</Tooltip>
						)}
						<ViewTabs tab={route.tab} className="hidden @3xl/sport:block" />
					</>
				}
			>
				<div className="flex h-full min-h-0 flex-col">
					<div className="shrink-0 border-b border-border px-4 py-2 @3xl/sport:hidden">
						<ViewTabs tab={route.tab} fill />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						{route.tab === "week" &&
							(plan === null ? (
								<div className="mx-auto flex max-w-xl flex-col gap-2 px-6 py-10 text-sm">
									<h2 className="text-base font-semibold">Pas encore de plan</h2>
									<p className="text-muted-foreground">Ton agent personnel écrit le plan. Demande-lui par exemple :</p>
									<blockquote className="rounded-lg border border-border bg-card px-4 py-3">« {ASK_FOR_PLAN} »</blockquote>
									<p className="text-muted-foreground">La semaine s'affiche ici dès qu'il l'enregistre. En attendant, « Séance libre » note une séance au journal.</p>
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
								keys={!dialogOpen}
							/>
						)}
						{route.tab === "progress" && <ProgressTab state={state} today={today} />}
					</div>
				</div>
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
				{saved && <SummaryDialog saved={saved} plan={plan} onClose={() => setSaved(null)} />}
				{weighing && bodyweight && <WeighForm state={state} metric={bodyweight} today={today} disabled={disabled} onChange={onChange} onClose={() => setWeighing(false)} />}
			</PageFrame>
		</SportRoot>
	);
}

/** The page's box, which its header and content size against, as a narrow pane and a phone both make it narrow. Its copy is French, so screen readers read it as French. */
function SportRoot({ children }: { children: ReactNode }) {
	return <div lang="fr" className="@container/sport flex h-full min-h-0 flex-1 flex-col">{children}</div>;
}

/** The week, journal, and progress tabs; `fill` spreads them over the row they sit in. */
function ViewTabs({ tab, className, fill = false }: { tab: SportRoute["tab"]; className?: string; fill?: boolean }) {
	return (
		<SegmentedTabs
			value={tab}
			onValueChange={next => {
				const view = SPORT_TABS.find(({ route }) => route.tab === next);
				if (view) location.hash = hashForSport(view.route);
			}}
			activationMode="manual"
			className={className}
		>
			<SegmentedTabsList aria-label="Vue" className={fill ? "w-full" : undefined}>
				{SPORT_TABS.map(({ route, name }) => (
					<SegmentedTab key={route.tab} value={route.tab} className={fill ? "flex-1" : undefined} {...activityControl(TAB_CONTROL[route.tab])}>
						{name}
					</SegmentedTab>
				))}
			</SegmentedTabsList>
		</SegmentedTabs>
	);
}
