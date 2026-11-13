import { IconArchive } from "central-icons";
import type { ReactNode } from "react";
import type { ControlPhase, LiveView } from "../../src/shared/sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PrivateChip } from "./private-chip";
import { CONFIRM_PRIVATE_END, hostLabel, PRIVATE_NOTE } from "../labels";
import { OpenPullRequestButton } from "../open-pull-request";
import { isPrivateHost } from "../sessions";
import { shortcutLabels } from "../shortcuts";
import { useInlineConfirm } from "../use-inline-confirm";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { Header } from "./page-header";
import { CRUMB_SEPARATOR, PARENT_CRUMB, SessionIdCopy } from "./session-meta";
import { SessionTitle } from "./session-title";
import type { Subject } from "./subject";
import { SessionGoalControl } from "./session-goal";

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
	/** A control the page puts right after the title. */
	titleAction?: ReactNode;
}

/**
 * A live session's title, which a session this dashboard runs renames when clicked, or a subagent's trail, `title / subagent` with its agent type as a badge, whose title opens its session;
 * the connection status; **Open PR** while its branch can take one; its directory in Cursor;
 * and End session, which shows it is ending until the server answers, though the session may leave the roster before then.
 * A private session shows a lock, and its End, which deletes it, asks for a second click.
 */
export function ConversationHeader({ view, subject, onEnd, actions, titleAction }: ConversationHeaderProps) {
	const { host, shown, agent, phase, live } = subject;
	const { open, request, editGoal } = useDashboardActions();
	const ending = useDashboardStatus().ending.has(view.instanceId);
	const status = ending
		? "Archiving…"
		: phase.phase === "live"
			? undefined
			: phase.phase === "connecting"
				? CONTROL_LABEL.connecting
				: `${CONTROL_LABEL[phase.phase]} · ${phase.reason}`;
	const endable = live && host ? host : ending ? shown : null;
	const isPrivate = isPrivateHost(shown);
	const confirm = useInlineConfirm(`end:${view.instanceId}`);
	const confirming = confirm.isArmed("end");
	const endNow = (): void => onEnd(view.instanceId);
	const title =
		subject.kind === "subagent" ? (
			<span className="inline-flex max-w-full min-w-0 items-center">
				{shown?.sessionName && (
					<>
						<button type="button" className={`${PARENT_CRUMB} min-w-0 cursor-pointer truncate hover:text-foreground hover:underline`} onClick={() => open({ ...view, agentId: null }, "replace")}>
							{shown.sessionName}
						</button>
						<span aria-hidden className={`${CRUMB_SEPARATOR} shrink-0`}>
							/
						</span>
					</>
				)}
				<span className="shrink-0">{agent?.id ?? view.agentId}</span>
				{agent && (
					<Badge variant="dot" size="compact" className="ml-2 shrink-0">
						{agent.kind}
					</Badge>
				)}
			</span>
		) : subject.switchable ? (
			<SessionTitle sessionId={subject.switchable.sessionId} title={hostLabel(subject.switchable)} />
		) : (
			(shown ? hostLabel(shown) : view.instanceId)
		);
	const goalSet = subject.kind === "session" && subject.switchable?.goal.kind === "set";
	const goal = subject.kind === "session" && subject.switchable ? <SessionGoalControl instanceId={view.instanceId} slot={subject.switchable.goal} onChange={change => request({ t: "goal", instanceId: view.instanceId, change })} onEdit={focus => editGoal(view.instanceId, focus)} /> : null;
	return (
		<Header
			title={title}
			trailing={
				<>
					{subject.kind === "session" && shown && <SessionIdCopy id={shown.sessionId} />}
					{titleAction}
					{!goalSet && goal}
				</>
			}
			status={status}
			alert={!ending && phase.phase === "ended"}
		>
			{isPrivate && (
				<Tooltip content={PRIVATE_NOTE} side="bottom">
					<span tabIndex={0} className="flex shrink-0 items-center rounded-full">
						<PrivateChip />
					</span>
				</Tooltip>
			)}
			{goalSet && goal}
			{subject.kind === "session" && <OpenPullRequestButton view={view} host={host} />}
			{subject.kind === "session" && endable && (
				<Tooltip
					content={
						isPrivate
							? "Deletes this conversation and everything it wrote. Nothing moves to Past sessions."
							: `Archive session. Stops the omp process ${endable.source === "dashboard" ? "this dashboard started" : `running in its terminal (pid ${endable.pid})`}. Its transcript moves to Past sessions, where Resume continues it.`
					}
					side="bottom"
				>
					<Button
						variant={confirming ? "destructive-outline" : "ghost"}
						size={confirming ? "compact" : "icon-compact"}
						loading={ending}
						aria-label={ending ? "Archiving…" : confirming ? CONFIRM_PRIVATE_END : "Archive session"}
						{...(isPrivate ? confirm.props("end", endNow) : { onClick: endNow })}
					>
						<IconArchive />
						{confirming && CONFIRM_PRIVATE_END}
					</Button>
				</Tooltip>
			)}
			{actions}
		</Header>
	);
}
