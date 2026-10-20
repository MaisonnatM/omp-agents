import { type ReactNode, useMemo } from "react";
import type { PastSession } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { MessageScrollerProvider } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { StartOf } from "../starts";
import type { ForkPoint } from "../transcript-view";
import { pastLabel, SOURCE_LABELS } from "../labels";
import { Header } from "./page-header";
import { SessionIdCopy, SessionMeta } from "./session-meta";
import { Trajectory } from "./trajectory";
import { NOTICE_TONE, Transcript } from "./transcript";

interface PastConversationProps {
	sessionId: string;
	/** The listed row, or `null` when the session is no longer listed. */
	session: PastSession | null;
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	resume: StartOf<"resume"> | null;
	onResume: () => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
	/** A control the page puts right after the title, such as the trajectory switch; a foreign session has no trajectory, so it gets none. */
	titleAction?: ReactNode;
	/** Show its turns in place of its transcript. */
	trajectory: boolean;
}

export function PastConversation({ sessionId, session, fork, onFork, resume, onResume, actions, titleAction, trajectory }: PastConversationProps) {
	const view = useMemo(() => ({ kind: "past" as const, sessionId }), [sessionId]);
	const title = session ? pastLabel(session) : "Past session";
	const resuming = resume?.phase === "starting" && resume.op.sessionId === sessionId;
	const failed = resume?.phase === "failed" && resume.op.sessionId === sessionId ? resume.error : null;
	const foreign = session !== null && session.source !== "omp";
	return (
		<MessageScrollerProvider autoScroll>
			<div className="flex h-full min-h-0 flex-1 flex-col">
				<Header
					title={title}
					trailing={
						<>
							<SessionIdCopy id={sessionId} />
							{!foreign && titleAction}
						</>
					}
					status={foreign ? `Read-only · ${SOURCE_LABELS[session.source]}` : "Read-only"}
					alert={false}
				>
					{session && (
						<>
							<SessionMeta facts={session} />
							{!foreign && (
								<Tooltip content="Start omp on this session's file from this dashboard, as omp --resume does, and continue it here.">
									<Button
										size="compact"
										onClick={onResume}
										disabled={resume?.phase === "starting"}
										aria-busy={resuming || undefined}
									>
										{resuming ? "Resuming…" : "Resume"}
									</Button>
								</Tooltip>
							)}
						</>
					)}
					{actions}
				</Header>
				{failed && (
					<p role="alert" className={cn("border-b border-border px-6 py-2 text-xs", NOTICE_TONE.error)}>
						{failed}
					</p>
				)}
				{trajectory && !foreign ? <Trajectory view={view} /> : <Transcript view={view} working={false} fork={foreign ? null : fork} onFork={foreign ? undefined : onFork} />}
			</div>
		</MessageScrollerProvider>
	);
}

