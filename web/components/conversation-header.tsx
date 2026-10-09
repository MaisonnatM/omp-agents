import { ArrowLeft, CircleStop } from "lucide-react";
import type { ReactNode } from "react";
import type { ControlPhase, LiveView } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { hostLabel } from "../labels";
import { shortcutLabels } from "../shortcuts";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { Header } from "./page-header";
import { PullRequestMenu, SessionTrail } from "./session-meta";
import type { Subject } from "./subject";

/** A live session shows no status: the header speaks up only while the connection is not live. */
const CONTROL_LABEL: Record<Exclude<ControlPhase["phase"], "live">, string> = {
	connecting: "Connecting…",
	reconnecting: "Reconnecting…",
	ended: "Disconnected",
};

interface ConversationHeaderProps {
	view: LiveView;
	subject: Subject;
	/** End running session `instanceId`, as the roster's End session does. */
	onEnd: (instanceId: string) => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
}

/**
 * A live session's or subagent's trail, `project / title`, or `project / title / subagent` with the way back to its session;
 * the connection status; a session's pull requests, its directory in Cursor, and End session, which shows it is
 * ending until the server answers, though the session may leave the roster before then.
 */
export function ConversationHeader({ view, subject, onEnd, actions }: ConversationHeaderProps) {
	const { host, shown, agent, phase, live } = subject;
	const { open } = useDashboardActions();
	const ending = useDashboardStatus().ending.has(view.instanceId);
	const status = ending
		? "Ending…"
		: phase.phase === "live"
			? undefined
			: phase.phase === "connecting"
				? CONTROL_LABEL.connecting
				: `${CONTROL_LABEL[phase.phase]} · ${phase.reason}`;
	const endable = live && host ? host : ending ? shown : null;
	const path = [shown?.sessionName, agent?.id].filter((name): name is string => !!name);
	const title = shown ? <SessionTrail cwdDisplay={shown.cwdDisplay} worktree={shown.worktree} path={path} /> : (agent?.id ?? view.instanceId);
	const session = shown ? hostLabel(shown) : "the session";
	const back = view.agentId !== null && (
		<Tooltip content={`Back to ${session}`} side="bottom">
			<Button
				variant="ghost"
				size="icon-compact"
				className="shrink-0 text-muted-foreground"
				aria-label={`Back to ${session}`}
				onClick={() => open({ ...view, agentId: null }, "replace")}
			>
				<ArrowLeft />
			</Button>
		</Tooltip>
	);
	return (
		<Header title={title} status={status} alert={!ending && phase.phase === "ended"} leading={back}>
			{subject.kind === "session" && shown && <PullRequestMenu pullRequests={shown.pullRequests} />}
			{subject.kind === "session" && endable && (
				<Tooltip
					content={
						endable.source === "dashboard"
							? "Stop the omp process this dashboard started. Its transcript moves to Past sessions, where Resume continues it."
							: `Stop the omp process running in its terminal (pid ${endable.pid}). Its transcript moves to Past sessions, where Resume continues it.`
					}
					shortcut={shortcutLabels("endSession")}
					side="bottom"
				>
					<Button variant="primary" size="compact" leadingIcon={CircleStop} loading={ending} onClick={() => onEnd(view.instanceId)}>
						End session
					</Button>
				</Tooltip>
			)}
			{actions}
		</Header>
	);
}
