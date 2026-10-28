import { Circle, CircleCheck, CircleDot, CirclePause, CircleSlash, type LucideIcon } from "lucide-react";
import type { TodoPhase, TodoTask } from "../../src/shared/transcript";
import { cn } from "@/lib/utils";

const STATUS: Record<TodoTask["status"], { icon: LucideIcon; label: string; className: string }> = {
	pending: { icon: Circle, label: "To do", className: "text-muted-foreground" },
	in_progress: { icon: CircleDot, label: "In progress", className: "text-blue-500" },
	completed: { icon: CircleCheck, label: "Done", className: "text-emerald-500" },
	blocked: { icon: CirclePause, label: "Blocked", className: "text-amber-500" },
	abandoned: { icon: CircleSlash, label: "Dropped", className: "text-muted-foreground" },
};

const isClosed = (task: TodoTask): boolean => task.status === "completed" || task.status === "abandoned";

/** How many tasks of `phases` are still open, which the tab's badge counts. */
export const openTodos = (phases: readonly TodoPhase[]): number => phases.reduce((open, phase) => open + phase.tasks.filter(task => !isClosed(task)).length, 0);

/** The agent's own todo list in the right sidebar, phase by phase, as its latest `todo` call left it. */
export function SessionTodosTab({ phases }: { phases: readonly TodoPhase[] }) {
	return (
		<div className="flex flex-col gap-4 px-4 pb-4">
			{phases.map((phase, index) => {
				const done = phase.tasks.filter(isClosed).length;
				return (
					<section key={`${index}:${phase.name}`} aria-label={phase.name || `Phase ${index + 1}`} className="flex flex-col gap-1.5">
						<h3 className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
							<span className="truncate">{phase.name}</span>
							<span className="shrink-0 tabular-nums">
								{done}/{phase.tasks.length}
							</span>
						</h3>
						<ul className="flex flex-col gap-1">
							{phase.tasks.map((task, at) => {
								const { icon: Icon, label, className } = STATUS[task.status];
								return (
									<li key={`${at}:${task.content}`} className="flex items-start gap-2 text-sm">
										<Icon aria-label={label} role="img" className={cn("mt-0.5 size-4 shrink-0", className)} />
										<span className="min-w-0 flex-1">
											<span className={cn("break-words", isClosed(task) && "text-muted-foreground line-through", task.status === "in_progress" && "font-medium")}>{task.content}</span>
											{task.blocker && <span className="block text-xs text-muted-foreground">{task.blocker}</span>}
										</span>
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
		</div>
	);
}
