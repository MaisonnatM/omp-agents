/** A Workspace's Routines tab on its Board: the card of its routines, one open, or a routine's editor, new or saved. */
import { useEffect, useState } from "react";
import type { Routine, RoutineSpec } from "../../../src/routines";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { folderName } from "../../labels";
import { draftOf, newDraft, type RoutineDraft, templateOf } from "../../routines-model";
import { hashForRoutines } from "../../routing";
import { useAction } from "../../use-action";
import type { RoutineRoute } from "../board/module";
import { useDashboardActions } from "../dashboard-context";
import { PageFrame } from "../list-page";
import { RoutineEditor } from "./routine-editor";
import { RoutinesCard } from "./routines-card";

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

export function RoutinesTab({ workspace, route, routines, held, workspaces, connected }: RoutinesTabProps) {
	const here = routines.filter(routine => routine.workspace === workspace);
	const named = route.kind === "open" || route.kind === "edit" ? route.id : null;
	const elsewhere = named === null || here.some(({ id }) => id === named) ? null : (routines.find(({ id }) => id === named) ?? null);
	const target = elsewhere && hashForRoutines(elsewhere.workspace, route);
	useEffect(() => {
		if (target) location.replace(target);
	}, [target]);
	if (target) return null;
	switch (route.kind) {
		case "list":
			return <RoutinesCard workspace={workspace} name={folderName(workspace) ?? workspace} routines={here} allRoutines={routines} held={held} openId={null} connected={connected} />;
		case "open":
			if (!here.some(({ id }) => id === route.id)) return <MissingRoutine workspace={workspace} />;
			return <RoutinesCard workspace={workspace} name={folderName(workspace) ?? workspace} routines={here} allRoutines={routines} held={held} openId={route.id} connected={connected} />;
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
