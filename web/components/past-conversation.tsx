import { type ReactNode, useMemo } from "react";
import type { PastSession } from "../../src/shared/sessions";
import type { Item } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { MessageScrollerProvider } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { StartOf } from "../starts";
import type { ForkPoint } from "../transcript-view";
import { Header } from "./page-header";
import { OpenInCursor, PullRequestMenu, SessionTrail } from "./session-meta";
import { NOTICE_TONE, Transcript } from "./transcript";

interface PastConversationProps {
	sessionId: string;
	/** The listed row, or `null` when the session is no longer listed. */
	session: PastSession | null;
	items: Item[];
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	resume: StartOf<"resume"> | null;
	onResume: () => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
}

/** A past session's saved transcript under its trail, `project / title`. It follows the file; **Resume** continues it in a session this dashboard starts. */
export function PastConversation({ sessionId, session, items, fork, onFork, resume, onResume, actions }: PastConversationProps) {
	const view = useMemo(() => ({ kind: "past" as const, sessionId }), [sessionId]);
	const title = session ? <SessionTrail cwdDisplay={session.cwdDisplay} worktree={session.worktree} path={session.title ? [session.title] : []} /> : "Past session";
	const resuming = resume?.phase === "starting" && resume.op.sessionId === sessionId;
	const failed = resume?.phase === "failed" && resume.op.sessionId === sessionId ? resume.error : null;
	return (
		<MessageScrollerProvider autoScroll>
			<div className="flex h-full min-h-0 flex-1 flex-col">
				<Header title={title} status="Read-only" alert={false}>
					{session && (
						<>
							<PullRequestMenu pullRequests={session.pullRequests} />
							<OpenInCursor dir={session.worktree ?? session.cwd} />
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
						</>
					)}
					{actions}
				</Header>
				{failed && (
					<p role="alert" className={cn("border-b border-border px-6 py-2 text-xs", NOTICE_TONE.error)}>
						{failed}
					</p>
				)}
				<Transcript view={view} items={items} working={false} fork={fork} onFork={onFork} />
			</div>
		</MessageScrollerProvider>
	);
}

