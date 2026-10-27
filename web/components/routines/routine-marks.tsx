/** What the sidebar's Routines tab and the Routines page both mark a routine with: its task's icon and its last run's dot. */
import { type LucideIcon, MessageSquareText, SquareTerminal } from "lucide-react";
import type { RoutineRun, RoutineTask } from "../../../src/routines";
import { cn } from "@/lib/utils";
import { PAGE_ICON } from "../../page-icons";
import { type RunHealth, runHealth, runWords } from "../../routines-model";

const TASK_ICON: Record<RoutineTask["kind"], LucideIcon> = { prompt: MessageSquareText, command: SquareTerminal, bot: PAGE_ICON.bots };

/** A prompt's speech bubble, a command's terminal, or the Bots page's icon for a Bot's message. */
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
