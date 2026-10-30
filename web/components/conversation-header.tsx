import { CircleStop, Eye } from "lucide-react";
import type { ReactNode } from "react";
import type { ControlPhase, LiveView } from "../../src/shared/sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { hostLabel } from "../labels";
import { OpenPullRequestButton } from "../open-pull-request";
import { openReview, reviewPagesStore } from "../review-pages";
import { shortcutLabels } from "../shortcuts";
import { BROWSER_AVAILABLE } from "./browser-panel";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { Header } from "./page-header";
import { CRUMB_SEPARATOR, PARENT_CRUMB, SessionIdCopy, SessionMeta } from "./session-meta";
import { SessionTitle } from "./session-title";
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
	/** A control the page puts right after the title. */
	titleAction?: ReactNode;
}

/**
 * A live session's title, which a session this dashboard runs renames when clicked, or a subagent's trail, `title / subagent` with its agent type as a badge, whose title opens its session;
 * the connection status; a session's Linear issues, pull requests, and the branch it works on, which copies a `cd` into its
 * linked worktree when clicked; **Open PR** while its branch can take one; its directory in Cursor;
 * and End session, which shows it is ending until the server answers, though the session may leave the roster before then.
 */
/** **Review visuals · N**, once the session listed pages to review, which opens each in its own Browser tab. */
function ReviewVisualsButton({ instanceId }: { instanceId: string }) {
	const pages = reviewPagesStore.use(instanceId);
	if (pages.length === 0) return null;
	return (
		<Tooltip content={pages.map(page => page.label).join(" · ")} side="bottom">
			<Button {...activityControl("conversation.review-visuals")} variant="outline" size="compact" leadingIcon={Eye} onClick={() => openReview(instanceId)}>
				Review visuals · {pages.length}
			</Button>
		</Tooltip>
	);
}

export function ConversationHeader({ view, subject, onEnd, actions, titleAction }: ConversationHeaderProps) {
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
	const title =
		subject.kind === "subagent" ? (
			<span className="inline-flex min-w-0 items-center">
				{shown?.sessionName && (
					<>
						<button type="button" className={`${PARENT_CRUMB} cursor-pointer hover:text-foreground hover:underline`} onClick={() => open({ ...view, agentId: null }, "replace")}>
							{shown.sessionName}
						</button>
						<span aria-hidden className={CRUMB_SEPARATOR}>
							/
						</span>
					</>
				)}
				<span>{agent?.id ?? view.agentId}</span>
				{agent && (
					<Badge variant="dot" size="compact" className="ml-2">
						{agent.kind}
					</Badge>
				)}
			</span>
		) : subject.switchable ? (
			<SessionTitle sessionId={subject.switchable.sessionId} title={hostLabel(subject.switchable)} />
		) : (
			(shown ? hostLabel(shown) : view.instanceId)
		);
	return (
		<Header
			title={title}
			trailing={
				<>
					{subject.kind === "session" && shown && <SessionIdCopy id={shown.sessionId} />}
					{titleAction}
				</>
			}
			status={status}
			alert={!ending && phase.phase === "ended"}
		>
			{subject.kind === "session" && shown && <SessionMeta facts={shown} />}
			{subject.kind === "session" && <OpenPullRequestButton view={view} host={host} />}
			{subject.kind === "session" && BROWSER_AVAILABLE && <ReviewVisualsButton instanceId={view.instanceId} />}
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
