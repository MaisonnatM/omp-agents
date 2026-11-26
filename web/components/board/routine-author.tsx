/** How a Board task or reply a routine posted names its author: the routine's loop and its name, a link while the routine exists. */
import { IconArrowsRepeat } from "central-icons";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Routine } from "../../../src/routines";
import { cn } from "@/lib/utils";
import { hashForRoutines } from "../../routing";

const RoutineIdsContext = createContext<ReadonlySet<string>>(new Set());

/** Gives the Board the ids of the routines that still exist, so a deleted routine's Board tasks name it without a link. */
export function RoutineIds({ routines, children }: { routines: readonly Routine[]; children: ReactNode }) {
	const ids = useMemo(() => new Set(routines.map(({ id }) => id)), [routines]);
	return <RoutineIdsContext.Provider value={ids}>{children}</RoutineIdsContext.Provider>;
}

export function RoutineAvatar({ size, box }: { size: "message" | "summary"; box: string }) {
	return (
		<span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-muted text-muted-foreground", box)}>
			<IconArrowsRepeat className={size === "message" ? "size-5" : "size-3.5"} />
		</span>
	);
}

/** The routine's name, which opens it in the Workspace's Routines tab while it exists. */
export function RoutineAuthorName({ routineId, name, workspace }: { routineId: string; name: string; workspace: string }) {
	const exists = useContext(RoutineIdsContext).has(routineId);
	return (
		<span className="flex min-w-0 items-baseline gap-1.5">
			{exists ? (
				<a href={hashForRoutines(workspace, { kind: "open", id: routineId })} className="truncate text-sm font-semibold hover:underline">
					{name}
				</a>
			) : (
				<span className="truncate text-sm font-semibold">{name}</span>
			)}
			<span className="shrink-0 text-xs text-muted-foreground">Routine</span>
		</span>
	);
}
