/** A log's figures as a row of cells, and the dialog that sums a session up once it is logged, with the records it beat. */
import { IconGauge, IconStar } from "central-icons";
import type { Plan } from "../../../src/shared/sport";
import { Button } from "@/components/ui/button";
import { hashForSport } from "../../routing";
import { amount, duration, effortWord, exerciseName, type Saved, sendsText, shortDate, signedAmount, signedKg } from "../../sport-view";
import { Callout } from "../integrations/integration-row";
import { SportDialog } from "./sport-dialog";

/** A row of labelled figures, such as a session's load, sends, pain, and effort. */
export function Stats({ cells }: { cells: { label: string; value: string }[] }) {
	return (
		<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
			{cells.map(({ label, value }) => (
				<div key={label} className="bg-background px-3 py-2">
					<dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
					<dd className="text-sm font-medium text-pretty break-words tabular-nums">{value}</dd>
				</div>
			))}
		</dl>
	);
}

/** A log's effort as its figures show it: `8/10 · dur`, `—` without one. */
export const effortText = (rpe: number | null): string => (rpe === null ? "—" : `${rpe}/10 · ${effortWord(rpe).toLowerCase()}`);

/** The heaviest of `loads` with its exercise's name in `plan`, `+35 kg · Tractions lestées`, `—` without one. */
export function heaviest(loads: Record<string, number>, plan: Plan | null): string {
	const top = Object.entries(loads).reduce<[string, number] | null>((best, entry) => (best === null || entry[1] > best[1] ? entry : best), null);
	return top === null ? "—" : `${signedKg(top[1])} · ${exerciseName(plan, top[0])}`;
}

export function SummaryDialog({ saved: { log, minutes, beaten, test }, plan, onClose }: { saved: Saved; plan: Plan | null; onClose: () => void }) {
	return (
		<SportDialog title="Séance notée" onClose={onClose} className="top-[15%] w-[min(32rem,calc(100vw-2rem))]">
			<div className="flex flex-col gap-4 px-5 pt-3 pb-4">
				<div>
					<p className="text-xs text-muted-foreground">{shortDate(log.date)}</p>
					<h2 className="text-lg font-semibold">{log.title}</h2>
				</div>
				<Stats
					cells={[
						{ label: "Durée prévue", value: minutes === null ? "—" : duration(minutes) },
						{ label: "Charge max", value: heaviest(log.loads, plan) },
						{ label: "Réussites", value: sendsText(log.climbs) },
						{ label: "Effort", value: effortText(log.rpe) },
					]}
				/>
				{test && (
					<Callout tone="info" icon={IconGauge}>
						Nouveau {test.metric.label.toLowerCase()} : <span className="font-medium">{amount(test.value, test.metric.unit)}</span>
						{test.was && `, ${signedAmount(test.value - test.was.value, test.metric.unit)} depuis le test du ${shortDate(test.was.at)}`}. Les charges de la phase sont recalculées.
					</Callout>
				)}
				{beaten.length > 0 && (
					<ul aria-label="Records" className="flex flex-col gap-1.5">
						{beaten.map(record => (
							<li key={record.label} className="flex items-center gap-2 text-sm">
								<IconStar aria-hidden className="size-4 shrink-0 fill-warning text-warning" />
								<span className="min-w-0 flex-1">
									Record · {record.label} <span className="font-medium tabular-nums">{record.now}</span>
								</span>
								<span className="shrink-0 text-xs text-muted-foreground">{record.was ? `avant : ${record.was}` : "premier"}</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
				<Button variant="tertiary" size="compact" className="rounded-full" asChild>
					<a href={hashForSport({ tab: "journal", open: log.id })} onClick={onClose}>Voir le journal</a>
				</Button>
				<Button size="compact" className="rounded-full" onClick={onClose}>Fermer</Button>
			</div>
		</SportDialog>
	);
}
