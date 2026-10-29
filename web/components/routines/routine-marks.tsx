/** What a Bot's details and its routines card mark a routine with: its task's icon, its triggers' logos, and its runs' dots, icons, and ticks. */
import { CalendarClock, CircleCheck, CircleDashed, CircleX, LoaderCircle, type LucideIcon, MessageSquareText, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import type { RoutineRun, RoutineTask, TriggerKind } from "../../../src/routines";
import { cn } from "@/lib/utils";
import { type RunHealth, runHealth, runWords } from "../../routines-model";
import { BrandMark, GMAIL_LOGO, SLACK_LOGO } from "../integrations/brand-logos";
import { OrgIcon } from "../org-icon";

const TASK_ICON: Record<RoutineTask["kind"], LucideIcon> = { prompt: MessageSquareText, command: SquareTerminal };

/** A message's speech bubble, or a command's terminal. */
export function TaskIcon({ task, className }: { task: RoutineTask; className?: string }) {
	const Icon = TASK_ICON[task.kind];
	return <Icon aria-hidden className={className} />;
}

const HEALTH_DOT: Record<RunHealth, string> = {
	ok: "bg-emerald-500",
	failed: "bg-red-500 shadow-[0_0_0_2px] shadow-red-500/25",
	running: "bg-blue-500 shadow-[0_0_0_2px] shadow-blue-500/25",
	waiting: "bg-amber-500",
};

/** Green once a run went fine, red once it had an error, blue while its command runs, amber while it waits; hollow before the first run. Its label is the run's words. */
export function RunDot({ run }: { run: RoutineRun | undefined }) {
	const label = run ? runWords(run) : "Not run yet";
	return (
		<span role="img" aria-label={label} className="flex size-3 shrink-0 items-center justify-center">
			<span className={cn("size-1.5 rounded-full", run ? HEALTH_DOT[runHealth(run)] : "border border-muted-foreground/60")} />
		</span>
	);
}

/** Each health's icon, so a run's result reads by its shape as well as its colour. */
const HEALTH_ICON: Record<RunHealth, { icon: LucideIcon; tone: string }> = {
	ok: { icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-400" },
	failed: { icon: CircleX, tone: "text-red-600 dark:text-red-400" },
	running: { icon: LoaderCircle, tone: "text-blue-600 dark:text-blue-400" },
	waiting: { icon: CircleDashed, tone: "text-amber-600 dark:text-amber-400" },
};

/** A result as its health's icon, labelled with its words. */
export function HealthIcon({ health, label, className }: { health: RunHealth; label: string; className?: string }) {
	const { icon: Icon, tone } = HEALTH_ICON[health];
	return <Icon role="img" aria-label={label} className={cn("size-3.5 shrink-0", tone, className)} />;
}

/** A run's result as an icon, labelled with the run's words. */
export function RunIcon({ run, className }: { run: RoutineRun; className?: string }) {
	return <HealthIcon health={runHealth(run)} label={runWords(run)} className={className} />;
}

/** Each health's tick on a routine's run strip. */
export const HEALTH_TICK: Record<RunHealth, string> = { ok: "bg-emerald-500", failed: "bg-red-500", running: "bg-blue-500", waiting: "bg-amber-500" };

const MARK = "size-3.5 shrink-0";

/** Each trigger's name and logo, the ones the notices bell marks the same sources with. */
export const TRIGGER_MARKS: Record<TriggerKind, { name: string; logo: ReactNode }> = {
	slack: { name: "Slack", logo: <BrandMark logo={SLACK_LOGO} className={MARK} /> },
	"pull-request": { name: "GitHub pull requests", logo: <OrgIcon org="github" className={MARK} /> },
	event: { name: "calendar events", logo: <CalendarClock aria-hidden className={MARK} /> },
	gmail: { name: "Gmail", logo: <BrandMark logo={GMAIL_LOGO} className={MARK} /> },
};
