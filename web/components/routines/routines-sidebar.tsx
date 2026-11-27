/** A Workspace's routines down the left of its Routines tab: a header with New routine, then a line per routine, the open one marked. */
import { IconPlusSmall } from "central-icons";
import type { KeyboardEvent } from "react";
import { type Routine, runsHere } from "../../../src/routines";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { hashForRoutines } from "../../routing";
import { RoutineListItem, stepIndex } from "./routine-row";

/** Arrow Up and Down, Home and End move between the routines' names. */
function moveBetweenNames(event: KeyboardEvent<HTMLUListElement>): void {
	if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-routine-name")) return;
	const names = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-routine-name]")];
	const index = stepIndex(event.key, names.indexOf(event.target), names.length, "y");
	if (index === null) return;
	event.preventDefault();
	names[index]!.focus();
}

interface RoutinesSidebarProps {
	/** The Workspace's directory, which its routines post in. */
	workspace: string;
	routines: Routine[];
	/** Why the queued runs wait to start, such as memory pressure; `null` when none waits. */
	held: string | null;
	/** The routine open on the right, `null` for none. */
	openId: string | null;
	className?: string;
}

export function RoutinesSidebar({ workspace, routines, held, openId, className }: RoutinesSidebarProps) {
	const runningHere = routines.filter(runsHere).length;
	return (
		<aside aria-labelledby="routines-sidebar-title" className={cn("flex min-h-0 flex-col border-r border-border", className)}>
			<header className="flex items-center gap-3 border-b border-border px-3 py-3">
				<div className="min-w-0 flex-1">
					<h2 id="routines-sidebar-title" className="text-sm font-semibold">
						Routines
					</h2>
					<p className="text-xs text-muted-foreground tabular-nums">
						{runningHere} of {routines.length} on schedule
					</p>
				</div>
				<Button {...activityControl("routines.new")} variant="outline" size="compact" leadingIcon={IconPlusSmall} render={<a href={hashForRoutines(workspace, { kind: "new" })} />}>New</Button>
			</header>
			{routines.length === 0 ? (
				<p className="px-3 py-6 text-sm text-pretty text-muted-foreground">No routines yet. A routine posts a Board task here on its schedules or its triggers. New makes one.</p>
			) : (
				<ul onKeyDown={moveBetweenNames} className="min-h-0 flex-1 space-y-px overflow-y-auto p-1.5">
					{routines.map(routine => (
						<RoutineListItem key={routine.id} routine={routine} held={held} open={routine.id === openId} />
					))}
				</ul>
			)}
		</aside>
	);
}
