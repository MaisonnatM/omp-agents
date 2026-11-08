/** The banner over the day while a pain flag holds: the pain, what it removes until when, and the days left. */
import { daysBetween } from "../../../src/shared/days";
import { PAIN_FLAG_DAYS, type PainFlag } from "../../../src/sport-week";
import { cn } from "@/lib/utils";
import { longDate, PAIN_PLACE_AT, painRule, painWord } from "../../sport-view";

export function PainBanner({ flag, today }: { flag: PainFlag; today: string }) {
	const left = daysBetween(today, flag.until).length - 1;
	const { effect } = painRule(flag.where);
	return (
		<section aria-label="Douleur notée" className="flex items-start gap-4 rounded-xl border border-warning/40 bg-warning-surface px-4 py-3">
			<p className="shrink-0 text-2xl font-semibold text-warning-foreground tabular-nums">{flag.level}/10</p>
			<div className="min-w-0 flex-1 text-sm">
				<p className="text-xs text-muted-foreground">
					Douleur {PAIN_PLACE_AT[flag.where]} ({painWord(flag.level).toLowerCase()}) · notée le {longDate(flag.date)}
				</p>
				<p className="font-medium">{effect} jusqu'au {longDate(flag.until)}</p>
				<p className="text-xs text-muted-foreground">Si la douleur est vive, précise, ou dure plus d'une semaine, vois un kiné avant de reprendre.</p>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1.5">
				<span aria-hidden className="flex gap-1">
					{Array.from({ length: PAIN_FLAG_DAYS }, (_, day) => <span key={day} className={cn("size-1.5 rounded-full", day < left ? "bg-warning" : "bg-warning/25")} />)}
				</span>
				<span className="text-xs text-muted-foreground">encore {left} {left === 1 ? "jour" : "jours"}</span>
			</div>
		</section>
	);
}
