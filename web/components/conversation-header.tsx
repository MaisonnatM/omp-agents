import { ArrowLeft, CircleStop } from "lucide-react";
import type { ReactNode } from "react";
import type { ControlPhase, LiveView } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { hostLabel } from "../labels";
import { shortcutLabels } from "../shortcuts";
import { useGitCheckout } from "../use-git-checkout";
import { AddToTodo } from "./add-to-todo";
import { useDashboardContext } from "./dashboard-context";
import { GitRef } from "./git";
import { Model } from "./model-picker";
import { Header } from "./page-header";
import { Project, PullRequests, Tickets } from "./session-meta";
import { ShipStep } from "./ship-step";
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

/** A live session's or subagent's title, what it runs on, its connection status, and End session; a subagent's leads with the way back to its session. */
export function ConversationHeader({ view, subject, onEnd, actions }: ConversationHeaderProps) {
	const { host, shown, agent, phase, live, working } = subject;
	const { open } = useDashboardContext();
	// Read again when a turn starts or ends, since a turn can switch the branch.
	const checkout = useGitCheckout(subject.kind === "session" ? (shown?.cwd ?? null) : null, working);
	const status =
		phase.phase === "live" ? undefined : phase.phase === "connecting" ? CONTROL_LABEL.connecting : `${CONTROL_LABEL[phase.phase]} · ${phase.reason}`;
	const title = agent ? agent.id : shown ? hostLabel(shown) : view.instanceId;
	const meta = agent
		? [`${agent.kind} subagent of ${shown ? hostLabel(shown) : "a session"}`, agent.activity].filter(Boolean).join(" · ")
		: shown && (
				<>
					<ShipStep ship={shown.ship} />{" "}
					<Project cwdDisplay={shown.cwdDisplay} />
					{checkout && (checkout.github || checkout.branch) && (
						<>
							{" · "}
							<GitRef github={checkout.github} branch={checkout.branch} />
						</>
					)}
					{" · "}
					{shown.model ? <Model selector={shown.model} /> : "no model"} · pid {shown.pid}
					<PullRequests pullRequests={shown.pullRequests} />
					<Tickets tickets={shown.tickets} />
				</>
			);
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
		<Header title={title} meta={meta} status={status} alert={phase.phase === "ended"} leading={back}>
			{subject.kind === "session" && shown && (
				<AddToTodo text={`Follow up on ${title}`} body="" link={{ kind: "session", sessionId: shown.sessionId }} label="Add a todo that links to this session" />
			)}
			{subject.kind === "session" && live && host && (
				<Tooltip
					content={
						host.source === "dashboard"
							? "Stop the omp process this dashboard started. Its transcript moves to Past sessions, where Resume continues it."
							: `Stop the omp process running in its terminal (pid ${host.pid}). Its transcript moves to Past sessions, where Resume continues it.`
					}
					shortcut={shortcutLabels("endSession")}
					side="bottom"
				>
					<Button variant="primary" size="compact" leadingIcon={CircleStop} onClick={() => onEnd(view.instanceId)}>
						End session
					</Button>
				</Tooltip>
			)}
			{actions}
		</Header>
	);
}
