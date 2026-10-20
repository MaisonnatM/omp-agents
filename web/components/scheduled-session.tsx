/** A scheduled new session's start, opened from the sidebar to view and edit as the new-session draft it was scheduled from. */
import { useContext, useState } from "react";
import type { ScheduledChange, ScheduledSend } from "../../src/shared/scheduled";
import { hashForSession, newSessionRequest, type NewSessionRequest } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import type { Completions } from "../pane-store";
import type { ScheduleWhen } from "../scheduled-model";
import { useAction } from "../use-action";
import { useMinute } from "../use-minute";
import { useDashboardActions } from "./dashboard-context";
import { NewSession, type ScheduledOp } from "./new-session";
import { ScheduledSends, whenLabel } from "./scheduled";

interface ScheduledSessionProps {
	/** The scheduled send the hash names; `null` names none. */
	id: string | null;
	workspaces: Workspace[];
	connected: boolean;
	completions: Completions | null;
	/** The todo `todoId` names, as the new-session draft words it. */
	todoOf: (todoId: string | null) => { text: string; prompt: string } | null;
}

export function ScheduledSession({ id, workspaces, connected, completions, todoOf }: ScheduledSessionProps) {
	const send = useContext(ScheduledSends).find(candidate => candidate.id === id);
	if (!send) return <p className="m-auto text-sm text-muted-foreground">It is no longer scheduled: it started, or was canceled.</p>;
	if (send.target.kind !== "start") {
		return (
			<p className="m-auto text-sm text-muted-foreground">
				A scheduled message waits above its session's composer. <a className="underline" href={hashForSession(send.target.sessionId)}>Open the session</a>
			</p>
		);
	}
	// Keyed by the send, so another one opens as its own draft.
	return <ScheduledDraftPage key={send.id} send={send} request={send.target.request} workspaces={workspaces} connected={connected} completions={completions} todoOf={todoOf} />;
}

interface DraftPageProps extends Omit<ScheduledSessionProps, "id"> {
	send: ScheduledSend;
	request: NewSessionRequest;
}

function ScheduledDraftPage({ send, request, workspaces, connected, completions, todoOf }: DraftPageProps) {
	const { request: ask, send: post } = useDashboardActions();
	const [cwd, setCwd] = useState(request.cwd);
	const now = useMinute();
	const change = useAction((...changes: ScheduledChange[]) => changes.reduce((done, next) => done.then(() => ask({ t: "schedule", change: next })), Promise.resolve()), "Could not change the scheduled session");
	/** The send with the draft's start, at `when`, else at its own time. */
	const updated = (op: ScheduledOp, when: ScheduleWhen | null): ScheduledChange => ({
		op: "update",
		send: { id: send.id, at: when?.at ?? send.at, reset: when ? when.reset : send.reset, target: { kind: "start", request: newSessionRequest(cwd, op.prompt, { ...op, todoId: request.todoId, subject: request.subject }) } },
	});
	return (
		<NewSession
			cwd={cwd}
			workspaces={workspaces}
			launch={null}
			connected={connected}
			completions={completions}
			onComplete={(reqId, text, cursor) => post({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
			onPickCwd={setCwd}
			onStart={op => change.run(updated(op, null), { op: "send-now", id: send.id })}
			onSchedule={(op, when) => ask({ t: "schedule", change: updated(op, when) })}
			todo={todoOf(request.todoId)}
			scheduled={{
				request,
				when: whenLabel(send, now),
				error: send.state.phase === "failed" ? send.state.error : null,
				busy: send.state.phase === "sending" || change.pending,
				onSave: op => ask({ t: "schedule", change: updated(op, null) }),
				onCancel: () => change.run({ op: "remove", id: send.id }),
			}}
		/>
	);
}
