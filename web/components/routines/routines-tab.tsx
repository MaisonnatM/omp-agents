/** A Workspace's Routines tab on its Board: its routines in a sidebar on the left, and on the right the open routine, a routine's editor, new or saved, or a missing-routine notice. */
import { IconChevronLeftSmall } from "central-icons";
import { type ReactNode, useEffect, useState } from "react";
import type { Routine, RoutineSpec } from "../../../src/routines";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { draftOf, newDraft, type RoutineDraft, templateOf } from "../../routines-model";
import { hashForRoutines } from "../../routing";
import { useAction } from "../../use-action";
import { useMinute } from "../../use-minute";
import type { RoutineRoute } from "../board/module";
import { useDashboardActions } from "../dashboard-context";
import { PageFrame } from "../list-page";
import { RoutineEditor } from "./routine-editor";
import { RoutineDetail } from "./routine-row";
import { RoutinesSidebar } from "./routines-sidebar";

/** The editor of a routine, new or saved; the routine opens in its Workspace's tab once the server has saved it, and a refused save says why. */
function RoutineEditorPage({
	workspace,
	initial,
	isNew,
	workspaces,
	template,
	connected,
}: {
	workspace: string;
	initial: RoutineDraft;
	isNew: boolean;
	workspaces: Workspace[];
	template: Routine | null;
	connected: boolean;
}) {
	const { request } = useDashboardActions();
	const save = useAction(async (spec: RoutineSpec) => {
		await request({ t: "routine", change: { op: "save", routine: spec } });
		location.hash = hashForRoutines(spec.workspace, { kind: "open", id: spec.id });
	}, "Could not save the routine");
	return (
		<RoutineEditor
			initial={initial}
			isNew={isNew}
			workspaces={workspaces}
			template={template}
			connected={connected}
			saving={save.pending}
			onCancel={() => (location.hash = hashForRoutines(workspace, isNew ? { kind: "list" } : { kind: "open", id: initial.id }))}
			onSave={spec => save.run(spec)}
		/>
	);
}

/** A new routine's editor for Workspace `workspace`, its id minted as it opens. */
function NewRoutine({ workspace, workspaces, connected }: { workspace: string; workspaces: Workspace[]; connected: boolean }) {
	const [initial] = useState(() => newDraft(crypto.randomUUID(), workspace));
	return <RoutineEditorPage workspace={workspace} initial={initial} isNew workspaces={workspaces} template={null} connected={connected} />;
}

/** In place of a routine the Workspace does not have, deleted or never made, with the way back to its routines. */
function MissingRoutine({ workspace }: { workspace: string }) {
	return (
		<PageFrame title="No such routine" meta="Routines">
			<div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 py-10 text-center text-sm text-pretty text-muted-foreground">
				<p>This Workspace has no routine at this address. It may have been deleted.</p>
				<Button variant="ghost" size="compact" render={<a href={hashForRoutines(workspace)} />}>Back to routines</Button>
			</div>
		</PageFrame>
	);
}

interface RoutinesTabProps {
	/** The Workspace's directory. */
	workspace: string;
	route: RoutineRoute;
	/** Every routine; the tab shows the Workspace's. */
	routines: Routine[];
	/** Why the queued runs wait to start, such as memory pressure; `null` when none waits. */
	held: string | null;
	workspaces: Workspace[];
	connected: boolean;
}

/** The right pane's content for `route`. */
function OpenPane({ workspace, route, here, routines, held, workspaces, connected }: RoutinesTabProps & { here: Routine[] }): ReactNode {
	const now = useMinute();
	switch (route.kind) {
		case "list":
			return (
				<p className="m-auto max-w-xs px-6 py-10 text-center text-sm text-pretty text-muted-foreground">
					{here.length === 0 ? "New makes this Workspace's first routine." : "Pick a routine on the left to see its runs, its task, and its schedule."}
				</p>
			);
		case "open": {
			const routine = here.find(({ id }) => id === route.id);
			if (!routine) return <MissingRoutine workspace={workspace} />;
			return (
				<div className="relative min-h-0 flex-1 overflow-y-auto">
					<RoutineDetail key={routine.id} routine={routine} template={templateOf(routine, routines)} held={held} connected={connected} now={now} />
				</div>
			);
		}
		case "new":
			return <NewRoutine workspace={workspace} workspaces={workspaces} connected={connected} />;
		case "edit": {
			const routine = here.find(({ id }) => id === route.id);
			if (!routine) return <MissingRoutine workspace={workspace} />;
			return (
				<RoutineEditorPage
					key={routine.id}
					workspace={workspace}
					initial={draftOf(routine)}
					isNew={false}
					workspaces={workspaces}
					template={templateOf(routine, routines)}
					connected={connected}
				/>
			);
		}
	}
}

export function RoutinesTab(props: RoutinesTabProps) {
	const { workspace, route, routines, held } = props;
	const here = routines.filter(routine => routine.workspace === workspace);
	const named = route.kind === "open" || route.kind === "edit" ? route.id : null;
	const elsewhere = named === null || here.some(({ id }) => id === named) ? null : (routines.find(({ id }) => id === named) ?? null);
	const target = elsewhere && hashForRoutines(elsewhere.workspace, route);
	useEffect(() => {
		if (target) location.replace(target);
	}, [target]);
	if (target) return null;
	const listing = route.kind === "list";
	return (
		<div className="flex h-full min-h-0 flex-1">
			{/* On a narrow screen the sidebar fills the tab until a routine opens, which then fills it with a way back. */}
			<RoutinesSidebar workspace={workspace} routines={here} held={held} openId={named} className={cn("w-full shrink-0 md:w-72", !listing && "max-md:hidden")} />
			<div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", listing && "max-md:hidden")}>
				{!listing && (
					<a href={hashForRoutines(workspace)} className="flex items-center gap-1 border-b border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground md:hidden">
						<IconChevronLeftSmall className="size-4" />
						Routines
					</a>
				)}
				<OpenPane {...props} here={here} />
			</div>
		</div>
	);
}
