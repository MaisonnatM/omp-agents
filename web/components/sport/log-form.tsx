/** The Fait dialog, which logs a session's loads, sends, pain, effort, and note, or a test's max and bodyweight; and the Pesée dialog. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { IconCheckmark1, IconCrossMedium, IconExclamationTriangle, IconPlusLarge } from "central-icons";
import { type KeyboardEvent, useId, useState } from "react";
import { errorText } from "../../../src/json";
import { type Climb, CLIMB_KINDS, type ClimbKind, FRENCH_GRADES, type Measurement, type Metric, PAIN_PLACES, type PainPlace, type SportChange, type SportState, type WorkoutLog } from "../../../src/shared/sport";
import { PAIN_FLAG_LEVEL, type PlannedExercise } from "../../../src/sport-week";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { amount, ARKOSE_COLORS, arkoseColor, CLIMB_LABEL, dose, effortWord, hardest, type LogTarget, logSave, longDate, measured, measurementChange, PAIN_PLACE_LABEL, painRule, painWord, type Saved, savedLoads, sendsText, shortDate, signedKg, testOf } from "../../sport-view";
import { ERROR_TEXT, isSubmitChord, type Submit } from "../form-dialog";
import { FIELD, TEXT_AREA } from "../form-field";
import { Callout } from "../integrations/integration-row";
import { effortText, heaviest, Stats } from "./log-summary";
import { SportDialog } from "./sport-dialog";

interface LogFormProps {
	state: SportState;
	target: LogTarget;
	disabled: boolean;
	/** Saves `changes` all together or none; rejects with why the server refused them. */
	onChange: (changes: SportChange[]) => Promise<void>;
	/** The session was logged done, with what its summary shows. */
	onSaved: (saved: Saved) => void;
	onClose: () => void;
}

/** A number typed the French way, `17,5`, `null` when the field is empty or not a number. */
function parsed(text: string): number | null {
	const value = Number(text.trim().replace(",", "."));
	return text.trim() === "" || !Number.isFinite(value) ? null : value;
}

const typed = (value: number | undefined): string => (value === undefined ? "" : String(value).replace(".", ","));

interface LoadRow {
	item: PlannedExercise;
	kg: string;
	done: boolean;
}

/** A dialog's write: busy while the server handles the changes, then the reason it refused them, which also words a field typed wrong. */
function useWrite(onChange: (changes: SportChange[]) => Promise<void>) {
	const [submit, setSubmit] = useState<Submit>({ kind: "writing" });
	const fail = (error: string) => setSubmit({ kind: "failed", error });
	/** Sends `changes` as one write, then `done`; a refusal leaves the dialog open with its reason. */
	const write = async (changes: SportChange[], done: () => void): Promise<void> => {
		setSubmit({ kind: "creating" });
		try {
			await onChange(changes);
		} catch (err) {
			fail(`Rien n'est enregistré : ${errorText(err)}`);
			return;
		}
		done();
	};
	return { submit, saving: submit.kind === "creating", fail, write };
}

export function LogForm({ state, target, disabled, onChange, onSaved, onClose }: LogFormProps) {
	const { date, workout, log } = target;
	const id = useId();
	const test = workout && testOf(state, workout);
	const onDay = (metric: Metric | null): Measurement | undefined => (metric ? measured(state, metric.id).find(({ at }) => at === date) : undefined);
	const [title, setTitle] = useState(log?.title ?? workout?.name ?? "Séance libre");
	const [rows, setRows] = useState<LoadRow[]>(() =>
		(workout?.blocks.flatMap(({ items }) => items) ?? [])
			.filter(item => item.exercise.load !== null && !item.removed && item.exercise.key !== test?.exercise.key)
			.map(item => ({ item, kg: typed(log ? log.loads[item.exercise.key] : item.load?.kg), done: log === null || Object.hasOwn(log.loads, item.exercise.key) })),
	);
	const [max, setMax] = useState(() => typed(onDay(test?.metric ?? null)?.value));
	const [weight, setWeight] = useState(() => typed(onDay(test?.bodyweight ?? null)?.value));
	const [climbs, setClimbs] = useState<Climb[]>(log?.climbs ?? []);
	const [pain, setPain] = useState<number | null>(log?.pain?.level ?? null);
	const [where, setWhere] = useState<PainPlace>(log?.pain?.where ?? "fingers");
	const [rpe, setRpe] = useState<number | null>(log?.rpe ?? null);
	const [note, setNote] = useState(log?.note ?? "");
	const { submit, saving, fail, write } = useWrite(onChange);

	const loads = savedLoads(log?.loads ?? {}, rows.map(({ item, kg, done }) => ({ key: item.exercise.key, kg: parsed(kg), done })));
	const entry = (status: WorkoutLog["status"]): WorkoutLog => ({
		id: log?.id ?? crypto.randomUUID(),
		date,
		workout: workout?.id ?? log?.workout ?? null,
		title: title.trim() || "Séance libre",
		status,
		rpe: status === "done" ? rpe : null,
		pain: status === "done" && pain !== null ? { level: pain, where } : null,
		loads: status === "done" ? loads : {},
		climbs: status === "done" ? climbs : [],
		note: note.trim(),
		addedBy: log?.addedBy ?? null,
	});

	function save() {
		const maxValue = parsed(max);
		if (test && maxValue === null) {
			fail(`Indique ton ${test.metric.label.toLowerCase()} en ${test.metric.unit}.`);
			return;
		}
		if (rows.some(({ kg, done }) => done && kg.trim() !== "" && parsed(kg) === null)) {
			fail("Une charge n'est pas un nombre.");
			return;
		}
		const { changes, saved } = logSave(state, target, { log: entry("done"), max: maxValue, weight: parsed(weight) });
		void write(changes, () => onSaved(saved));
	}

	const onKeyDown = (event: KeyboardEvent) => {
		if (!isSubmitChord(event) || disabled || saving) return;
		event.preventDefault();
		save();
	};
	const kicker = [longDate(date), log ? null : workout?.name].filter(part => part).join(" · ");
	return (
		<SportDialog title={log ? "Modifier la séance" : workout ? "Séance faite" : "Séance libre"} busy={saving} onClose={onClose} className="top-[4%] w-[min(40rem,calc(100vw-2rem))]">
			<div className="flex flex-col gap-5 px-5 pt-1 pb-4" onKeyDown={onKeyDown}>
				<p className="text-xs text-muted-foreground first-letter:uppercase">{kicker}</p>
				{workout === null && (
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						Titre
						<input className={FIELD} value={title} onChange={event => setTitle(event.target.value)} />
					</label>
				)}
				{test && (
					<div className="grid grid-cols-2 gap-3">
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							{test.metric.label} ({test.metric.unit})
							<input className={FIELD} inputMode="decimal" value={max} placeholder={typed(measured(state, test.metric.id).at(-1)?.value)} onChange={event => setMax(event.target.value)} />
						</label>
						{test.bodyweight && (
							<label className="flex flex-col gap-1.5 text-sm font-medium">
								{test.bodyweight.label} ({test.bodyweight.unit})
								<input className={FIELD} inputMode="decimal" value={weight} placeholder={typed(measured(state, test.bodyweight.id).at(-1)?.value)} onChange={event => setWeight(event.target.value)} />
							</label>
						)}
						<p className="col-span-2 text-xs text-muted-foreground">Les charges de la phase seront recalculées d'après ce test.</p>
					</div>
				)}
				{rows.length > 0 && (
					<div>
						<p className="pb-1.5 text-xs text-muted-foreground">Charges · préremplies avec la charge prévue, décoche ce que tu n'as pas fait</p>
						<table className="w-full text-sm">
							<thead className="text-left text-xs text-muted-foreground">
								<tr className="border-b border-border">
									<th className="py-1.5 font-normal">Exercice</th>
									<th className="py-1.5 font-normal">Précédent</th>
									<th className="py-1.5 font-normal">Charge</th>
									<th className="py-1.5 font-normal"><span className="sr-only">Fait</span></th>
								</tr>
							</thead>
							<tbody>
								{rows.map(({ item, kg, done }, index) => {
									const update = (change: Partial<LoadRow>) => setRows(rows.with(index, { ...rows[index]!, ...change }));
									return (
										<tr key={item.exercise.key} className={cn("border-b border-border last:border-b-0", !done && "text-muted-foreground")}>
											<td className="py-2 pr-3">
												<span className="block">{item.exercise.name}</span>
												<span className="block text-xs text-muted-foreground">{dose(item.exercise)}</span>
											</td>
											<td className="py-2 pr-3 tabular-nums text-muted-foreground">{item.load?.from === "log" ? signedKg(item.load.kg) : "—"}</td>
											<td className="py-2 pr-3">
												<span className="flex items-center gap-1.5">
													<input aria-label={`Charge, ${item.exercise.name}`} className={cn(FIELD, "w-20 tabular-nums")} inputMode="decimal" value={kg} disabled={!done} placeholder="à tester" onChange={event => update({ kg: event.target.value })} />
													<span className="text-xs text-muted-foreground">kg</span>
												</span>
											</td>
											<td className="py-2 text-right">
												<button type="button" role="checkbox" aria-checked={done} aria-label={`Fait, ${item.exercise.name}`} onClick={() => update({ done: !done })} className={cn("inline-flex size-7 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring", done ? "border-foreground bg-foreground text-background" : "border-border bg-background")}>
													{done && <IconCheckmark1 className="size-4" />}
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				<Climbs climbs={climbs} kind={workout?.kind === "route" ? "route" : "boulder"} onChange={setClimbs} />
				<Scale label="Douleur" values={range(0, 10)} value={pain} word={painWord} ends={["0 · aucune", "5", "10 · arrête"]} tone="warning" onPick={setPain} />
				{pain !== null && pain > 0 && (
					<div className="-mt-2 flex flex-col gap-2">
						<RadioGroup aria-label="Où" value={where} onValueChange={next => setWhere(PAIN_PLACES.find(place => place === next) ?? where)} className="flex flex-wrap gap-1.5">
							{PAIN_PLACES.map(place => (
								<Radio.Root key={place} value={place} className="cursor-pointer rounded-full border border-border px-2.5 py-0.5 text-xs outline-none not-data-[checked]:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground">
									{PAIN_PLACE_LABEL[place]}
								</Radio.Root>
							))}
						</RadioGroup>
						{pain >= PAIN_FLAG_LEVEL && (
							<Callout tone="warning" icon={IconExclamationTriangle}>
								{painRule(where).warning}
							</Callout>
						)}
					</div>
				)}
				<Scale label="Effort ressenti" values={range(1, 10)} value={rpe} word={level => `${effortWord(level)} ${level}/10`} ends={["1 · facile", "5 · modéré", "10 · maximal"]} tone="primary" onPick={setRpe} />
				<label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${id}-note`}>
					Note
					<textarea id={`${id}-note`} className={cn(TEXT_AREA, "min-h-16 font-normal")} value={note} onChange={event => setNote(event.target.value)} />
				</label>
				<Stats
					cells={[
						rows.length > 0 ? { label: "Charges", value: `${rows.filter(({ done }) => done).length} sur ${rows.length}` } : { label: "Charge max", value: heaviest(loads, state.plan) },
						{ label: "Réussites", value: sendsText(climbs) },
						{ label: "Douleur", value: pain === null || pain === 0 ? "aucune" : `${pain}/10 · ${PAIN_PLACE_LABEL[where].toLowerCase()}` },
						{ label: "Effort", value: effortText(rpe) },
					]}
				/>
				{submit.kind === "failed" && <p role="alert" className={ERROR_TEXT}>{submit.error}</p>}
			</div>
			<div className="flex items-center gap-3 border-t border-border px-4 py-3">
				{workout && log?.status !== "skipped" && (
					<Button
						variant="ghost"
						size="compact"
						disabled={disabled || saving}
						onClick={() => void write([{ op: log ? "edit-log" : "add-log", log: entry("skipped") }], onClose)}
					>
						Pas faite
					</Button>
				)}
				<span className="flex-1" />
				<Button variant="tertiary" size="compact" disabled={saving} onClick={onClose}>Annuler</Button>
				<Button size="compact" loading={saving} disabled={disabled || saving} onClick={save} {...activityControl("sport.log.save")}>Enregistrer</Button>
			</div>
		</SportDialog>
	);
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);

interface ScaleProps {
	label: string;
	values: number[];
	value: number | null;
	word: (level: number) => string;
	/** What the first, middle, and last buttons mean, under them. */
	ends: [string, string, string];
	tone: "warning" | "primary";
	onPick: (value: number | null) => void;
}

/** A row of numbered buttons, one picked, with the picked one's word and a button that clears it. */
function Scale({ label, values, value, word, ends, tone, onPick }: ScaleProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
				{label}
				{value !== null && <span className="font-medium text-foreground">· {word(value)}</span>}
				{value !== null && (
					<button type="button" onClick={() => onPick(null)} className="text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">Effacer</button>
				)}
			</p>
			<RadioGroup aria-label={label} value={value} onValueChange={next => onPick(values.find(level => level === next) ?? null)} className="flex gap-1">
				{values.map(level => (
					<Radio.Root
						key={level}
						value={level}
						className={cn(
							"inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-sm tabular-nums outline-none not-data-[checked]:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
							tone === "warning" ? "data-[checked]:border-warning data-[checked]:bg-warning-surface data-[checked]:font-medium data-[checked]:text-warning-foreground" : "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
						)}
					>
						{level}
					</Radio.Root>
				))}
			</RadioGroup>
			<p className="flex justify-between text-[11px] text-muted-foreground">
				{ends.map(end => <span key={end}>{end}</span>)}
			</p>
		</div>
	);
}

const KIND_ITEMS = CLIMB_KINDS.map(value => ({ value, label: CLIMB_LABEL[value] }));
const GRADE_ITEMS = FRENCH_GRADES.map(value => ({ value, label: value }));
const COLOR_ITEMS: { value: string | null; label: string }[] = [{ value: null, label: "Sans couleur" }, ...ARKOSE_COLORS];

/** The boulders and routes sent, each with its kind, grade, Arkose color, and whether it was on the Kilter board. */
function Climbs({ climbs, kind, onChange }: { climbs: Climb[]; kind: ClimbKind; onChange: (climbs: Climb[]) => void }) {
	const update = (index: number, change: Partial<Climb>) => onChange(climbs.with(index, { ...climbs[index]!, ...change }));
	const add = () => {
		const last = climbs.at(-1);
		onChange([...climbs, { kind: last?.kind ?? kind, grade: last?.grade ?? hardest(climbs)?.grade ?? "6b", color: null, kilter: false, attempts: null }]);
	};
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs text-muted-foreground">Blocs et voies réussis</p>
			{climbs.map((climb, index) => (
				<div key={index} className="flex flex-wrap items-center gap-2">
					<Select items={KIND_ITEMS} value={climb.kind} onValueChange={next => next && update(index, { kind: next })}>
						<SelectTrigger aria-label="Type" className="w-24">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{KIND_ITEMS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
						</SelectContent>
					</Select>
					<Select items={GRADE_ITEMS} value={climb.grade} onValueChange={next => next && update(index, { grade: next })}>
						<SelectTrigger aria-label="Cotation" className="w-20">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{GRADE_ITEMS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
						</SelectContent>
					</Select>
					<span className="flex min-w-32 flex-1 items-center gap-1.5">
						<span aria-hidden className="size-3 shrink-0 rounded-full border border-border" style={{ background: arkoseColor(climb.color)?.dot ?? "transparent" }} />
						<Select items={COLOR_ITEMS} value={climb.color} onValueChange={next => update(index, { color: next })}>
							<SelectTrigger aria-label="Couleur" className="min-w-0 flex-1">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{COLOR_ITEMS.map(({ value, label }) => <SelectItem key={label} value={value}>{label}</SelectItem>)}
							</SelectContent>
						</Select>
					</span>
					<label className="flex items-center gap-1.5 text-sm">
						<input type="checkbox" checked={climb.kilter} onChange={event => update(index, { kilter: event.target.checked })} />
						Kilter
					</label>
					<Button variant="ghost" size="icon-compact" aria-label="Retirer cette réussite" onClick={() => onChange(climbs.toSpliced(index, 1))}><IconCrossMedium /></Button>
				</div>
			))}
			<Button variant="tertiary" size="compact" leadingIcon={IconPlusLarge} className="self-start" onClick={add}>Ajouter une réussite</Button>
		</div>
	);
}

interface WeighFormProps {
	state: SportState;
	metric: Metric;
	today: string;
	disabled: boolean;
	onChange: (changes: SportChange[]) => Promise<void>;
	onClose: () => void;
}

/** The Pesée dialog: one bodyweight on a day, which replaces that day's when there is one. */
export function WeighForm({ state, metric, today, disabled, onChange, onClose }: WeighFormProps) {
	const rows = measured(state, metric.id);
	const [date, setDate] = useState(today);
	const [value, setValue] = useState("");
	const { submit, saving, fail, write } = useWrite(onChange);
	const last = rows.at(-1);
	function save() {
		const kg = parsed(value);
		if (kg === null || kg <= 0) {
			fail(`Indique ton ${metric.label.toLowerCase()} en ${metric.unit}.`);
			return;
		}
		void write([measurementChange(state, metric.id, date, kg)], onClose);
	}
	return (
		<SportDialog title="Pesée" busy={saving} onClose={onClose} className="top-[15%] w-[min(24rem,calc(100vw-2rem))]">
			<div
				className="flex flex-col gap-3 px-5 pt-2 pb-4"
				onKeyDown={event => {
					if (!isSubmitChord(event) || disabled || saving) return;
					event.preventDefault();
					save();
				}}
			>
				<div className="grid grid-cols-2 gap-3">
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						{metric.label} ({metric.unit})
						<input autoFocus className={FIELD} inputMode="decimal" value={value} placeholder={typed(last?.value)} onChange={event => setValue(event.target.value)} />
					</label>
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						Jour
						<input type="date" className={FIELD} value={date} max={today} onChange={event => setDate(event.target.value || today)} />
					</label>
				</div>
				{last && <p className="text-xs text-muted-foreground">Dernière pesée : {amount(last.value, metric.unit)} le {shortDate(last.at)}</p>}
				{submit.kind === "failed" && <p role="alert" className={ERROR_TEXT}>{submit.error}</p>}
			</div>
			<div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
				<Button variant="tertiary" size="compact" disabled={saving} onClick={onClose}>Annuler</Button>
				<Button size="compact" loading={saving} disabled={disabled || saving} onClick={save} {...activityControl("sport.weigh.save")}>Enregistrer</Button>
			</div>
		</SportDialog>
	);
}
