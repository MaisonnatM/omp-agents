/** The Sport page's journal: every logged session by week, newest first, beside the open one's figures. */
import { IconNotebook } from "central-icons";
import type { ReactNode } from "react";
import type { SportChange, SportState, WorkoutLog } from "../../../src/shared/sport";
import { records } from "../../../src/sport-week";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { useShortcuts } from "../../shortcuts";
import { arkoseColor, CLIMB_LABEL, dayOfMonth, duration, exerciseName, journalWeeks, KIND_COLOR, logDetail, longDate, PAIN_PLACE_LABEL, painWord, PLACE_LABEL, recordLogs, sendsText, shortDate, signedKg, weekdayShort, workoutOf } from "../../sport-view";
import { focusRow, stepRows, useReturnFocus } from "../list-page";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { toasts } from "../toaster";
import { effortText, heaviest, Stats } from "./log-summary";
import { sportHash } from "./nav";

interface JournalTabProps {
	state: SportState;
	/** The open log's id. */
	open: string | null;
	disabled: boolean;
	onChange: (changes: SportChange[]) => Promise<void>;
	onEdit: (log: WorkoutLog) => void;
	/** `false` while a dialog over the page takes the keys. */
	keys: boolean;
}

const logRowId = (id: string): string => `sport-log-${id}`;

/** Minutes as a week's total: `7 h 05`, `2 h`. */
function hours(minutes: number): string {
	const rest = minutes % 60;
	return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

export function JournalTab({ state, open, disabled, onChange, onEdit, keys }: JournalTabProps) {
	const weeks = journalWeeks(state);
	const logs = weeks.flatMap(week => week.logs);
	const marked = recordLogs(records(state));
	const at = logs.findIndex(({ id }) => id === open);
	const shown = at === -1 ? null : logs[at]!;
	const navigate = (id: string | null) => {
		location.hash = sportHash({ tab: "journal", open: id });
	};
	const rowOf = (log: WorkoutLog): HTMLElement | null => document.getElementById(logRowId(log.id));
	useReturnFocus(shown?.id ?? null, id => id, id => document.getElementById(logRowId(id))?.querySelector("a"), state);
	const step = (by: -1 | 1): void => {
		if (shown === null) {
			stepRows(logs, rowOf, by);
			return;
		}
		const next = logs[at + by];
		if (!next) return;
		navigate(next.id);
		const row = rowOf(next);
		if (row) focusRow(row);
	};
	useShortcuts(keys ? { sportJournalNext: () => step(1), sportJournalPrevious: () => step(-1), sportJournalClose: () => { if (shown !== null) navigate(null); } } : {});
	function remove(log: WorkoutLog) {
		const index = state.log.findIndex(({ id }) => id === log.id);
		void onChange([{ op: "remove-log", id: log.id }]);
		navigate(null);
		toasts.add({
			id: "sport-log-undo",
			title: `Séance du ${shortDate(log.date)} supprimée`,
			timeout: 8000,
			actionProps: {
				children: "Annuler",
				onClick: () => {
					void onChange([{ op: "restore-log", log, index }]);
					navigate(log.id);
					toasts.close("sport-log-undo");
				},
			},
		});
	}
	const list = (
		<div className="mx-auto w-full max-w-3xl px-3 py-2">
			{weeks.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Aucune séance notée. Dans la semaine, « Fait… » note une séance du plan, et « Séance libre » une autre.</p>}
			{weeks.map(week => (
				<section key={week.monday} aria-label={`Semaine du ${shortDate(week.monday)}`} className="pb-2">
					<h3 className="flex items-baseline justify-between px-2 pt-2 pb-1 text-xs text-muted-foreground">
						<span>Semaine du {shortDate(week.monday)}</span>
						<span className="tabular-nums">{week.done} {week.done > 1 ? "faites" : "faite"} · {hours(week.minutes)}</span>
					</h3>
					<ul className="flex flex-col gap-0.5">
						{week.logs.map(log => {
							const kind = workoutOf(state.plan, log.workout)?.kind ?? null;
							return (
								<li key={log.id} id={logRowId(log.id)}>
									<a href={sportHash({ tab: "journal", open: log.id })} aria-current={log.id === open ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-2 py-1.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", log.id === open && "bg-accent")}>
										<span aria-hidden className="h-8 w-1 shrink-0 rounded-full" style={{ background: kind && log.status === "done" ? KIND_COLOR[kind] : "var(--border)" }} />
										<span className="w-8 shrink-0 text-center">
											<span className="block text-[11px] text-muted-foreground uppercase">{weekdayShort(log.date)}</span>
											<span className="block text-sm font-medium tabular-nums">{dayOfMonth(log.date)}</span>
										</span>
										<span className="min-w-0 flex-1">
											<span className="flex items-center gap-1.5">
												<span className="truncate text-sm font-medium">{log.title}</span>
												{marked.has(log.id) && <Badge variant="dot" size="compact" color="amber">Record</Badge>}
											</span>
											<span className="block truncate text-xs text-muted-foreground">{logDetail(log) || "faite"}</span>
										</span>
									</a>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
	return (
		<ListSplit
			widthKey="omp-agents.sport-journal-width"
			resizeLabel="Redimensionner le journal"
			detailLabel="Séance ouverte"
			empty={{ icon: IconNotebook, title: "Aucune séance ouverte", hint: "Clique une séance pour voir ses charges, ses réussites et sa note." }}
			list={list}
			detail={
				shown === null ? null : (
					<section key={shown.id} aria-label={shown.title}>
						<DetailBar
							leading="Journal"
							previous={{ label: "Séance plus récente", icon: CH_PREVIOUS, shortcut: "sportJournalPrevious", onClick: at > 0 ? () => navigate(logs[at - 1]!.id) : undefined }}
							next={{ label: "Séance plus ancienne", icon: CH_NEXT, shortcut: "sportJournalNext", onClick: at < logs.length - 1 ? () => navigate(logs[at + 1]!.id) : undefined }}
							close={{ label: "Fermer la séance", icon: CH_CLOSE, shortcut: "sportJournalClose", onClick: () => navigate(null) }}
						/>
						<LogDetail state={state} log={shown} record={marked.has(shown.id)} disabled={disabled} onEdit={() => onEdit(shown)} onRemove={() => remove(shown)} />
					</section>
				)
			}
		/>
	);
}

function LogDetail({ state, log, record, disabled, onEdit, onRemove }: { state: SportState; log: WorkoutLog; record: boolean; disabled: boolean; onEdit: () => void; onRemove: () => void }) {
	const workout = workoutOf(state.plan, log.workout);
	const loads = Object.entries(log.loads);
	return (
		<div className="flex flex-col gap-5 px-6 py-5">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground first-letter:uppercase">{longDate(log.date)} · {log.workout ? "séance du plan" : "séance libre"}</p>
					<h2 className="text-xl font-semibold">{log.title}</h2>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{log.status === "done" ? <Badge variant="dot" size="compact" color="green">Faite</Badge> : <Badge variant="dot" size="compact" color="gray">Pas faite</Badge>}
						{record && <Badge variant="dot" size="compact" color="amber">Record</Badge>}
						{workout && <Badge size="compact">{PLACE_LABEL[workout.place]}</Badge>}
					</div>
				</div>
				<div className="flex gap-2">
					<Button variant="tertiary" size="compact" disabled={disabled} onClick={onEdit} {...activityControl("sport.journal.edit")}>Modifier…</Button>
					<Button variant="destructive-outline" size="compact" disabled={disabled} onClick={onRemove} {...activityControl("sport.journal.remove")}>Supprimer</Button>
				</div>
			</header>
			{log.status === "done" && (
				<Stats
					cells={[
						{ label: "Durée prévue", value: workout ? duration(workout.minutes) : "—" },
						{ label: "Charge max", value: heaviest(log.loads, state.plan) },
						{ label: "Réussites", value: sendsText(log.climbs) },
						{ label: "Effort", value: effortText(log.rpe) },
					]}
				/>
			)}
			{loads.length > 0 && (
				<Section title="Charges">
					{loads.map(([key, kg]) => (
						<li key={key} className="flex justify-between gap-3 py-1.5 text-sm">
							<span>{exerciseName(state.plan, key)}</span>
							<span className="font-medium tabular-nums">{signedKg(kg)}</span>
						</li>
					))}
				</Section>
			)}
			{log.climbs.length > 0 && (
				<Section title="Réussis">
					{log.climbs.map((climb, index) => (
						<li key={index} className="flex items-center justify-between gap-3 py-1.5 text-sm">
							<span className="flex items-center gap-2">
								{climb.color && <span aria-hidden className="size-2.5 rounded-full border border-border" style={{ background: arkoseColor(climb.color)?.dot }} />}
								{[CLIMB_LABEL[climb.kind], climb.color && (arkoseColor(climb.color)?.label ?? climb.color), climb.kilter ? "Kilter" : null].filter(part => part).join(" · ")}
							</span>
							<span className="font-medium tabular-nums">{climb.grade}</span>
						</li>
					))}
				</Section>
			)}
			{log.pain && log.pain.level > 0 && (
				<Section title="Douleur">
					<li className="py-1.5 text-sm">{log.pain.level}/10 · {PAIN_PLACE_LABEL[log.pain.where].toLowerCase()} · {painWord(log.pain.level).toLowerCase()}</li>
				</Section>
			)}
			{log.note && (
				<div>
					<h3 className="pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Note</h3>
					<p className="text-sm whitespace-pre-wrap">{log.note}</p>
				</div>
			)}
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div>
			<h3 className="border-b border-border pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
			<ul>{children}</ul>
		</div>
	);
}
