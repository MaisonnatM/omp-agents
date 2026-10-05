import { type ReactNode, useMemo } from "react";
import type { Item, PastSession } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { MessageScrollerProvider } from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import { pastLabel } from "../labels";
import type { StartOf } from "../starts";
import type { ForkPoint } from "../transcript-view";
import { Header } from "./page-header";
import { Project, PullRequests, Tickets } from "./session-meta";
import { ShipStep } from "./ship-step";
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

/** A past session's saved transcript. It follows the file; **Resume** continues it in a session this dashboard starts. */
export function PastConversation({ sessionId, session, items, fork, onFork, resume, onResume, actions }: PastConversationProps) {
	const view = useMemo(() => ({ kind: "past" as const, sessionId }), [sessionId]);
	const meta = session ? (
		<>
			<ShipStep ship={session.ship} />{" "}
			<Project cwdDisplay={session.cwdDisplay} /> · last active {new Date(session.modifiedAt).toLocaleString()}
			<PullRequests pullRequests={session.pullRequests} />
			<Tickets tickets={session.tickets} />
		</>
	) : (
		sessionId
	);
	const resuming = resume?.phase === "starting" && resume.op.sessionId === sessionId;
	const failed = resume?.phase === "failed" && resume.op.sessionId === sessionId ? resume.error : null;
	return (
		<MessageScrollerProvider autoScroll>
			<div className="flex h-full min-h-0 flex-1 flex-col">
				<Header title={session ? pastLabel(session) : "Past session"} meta={meta} status="Read-only" alert={false}>
					{session && (
						<Button
							variant="secondary"
							size="compact"
							onClick={onResume}
							disabled={resume?.phase === "starting"}
							aria-busy={resuming || undefined}
							title="Start omp on this session's file from this dashboard, as omp --resume does, and continue it here."
						>
							{resuming ? "Resuming…" : "Resume"}
						</Button>
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
