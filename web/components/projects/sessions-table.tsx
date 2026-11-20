/** A project's sessions in a table, running first, each with its status, the pull requests it links, and its last log line's time. */
import type { Project } from "../../../src/shared/projects";
import { hashForSession } from "../../../src/shared/sessions";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { Age } from "../age";
import { type KnownSessions, TodoLinkChip } from "../todo/links";
import { Card, EmptyNote, StatusBadge } from "./parts";
import type { ProjectSession } from "./project-work";

const HEAD = "h-9 font-medium whitespace-nowrap";

export function SessionsTable({ project, rows, sessions, archived }: { project: Project; rows: ProjectSession[]; sessions: KnownSessions; archived: boolean }) {
	return (
		<Card title="Sessions">
			{rows.length === 0 ? (
				<EmptyNote>{archived ? "No session joined this project." : "Start one with New session, or move one here from its menu in the sidebar."}</EmptyNote>
			) : (
				<div className="@container">
					<table className="w-full table-fixed text-sm">
						<caption className="sr-only">The project's sessions, running first</caption>
						<thead>
							<tr className="border-b border-border text-left text-xs text-muted-foreground">
								<th scope="col" className={cn(HEAD, "px-4")}>
									Session
								</th>
								<th scope="col" className={cn(HEAD, "w-24 px-3")}>
									Status
								</th>
								<th scope="col" className={cn(HEAD, "w-32 px-3 @max-lg:hidden")}>
									Pull requests
								</th>
								<th scope="col" className={cn(HEAD, "w-24 px-4 text-right")}>
									Last update
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map(row => (
								<SessionRow key={row.id} row={row} lastLog={project.log.findLast(entry => entry.sessionId === row.id)?.at} sessions={sessions} />
							))}
						</tbody>
					</table>
				</div>
			)}
		</Card>
	);
}

function SessionRow({ row: { id, name, host, pullRequests }, lastLog, sessions }: { row: ProjectSession; lastLog: string | undefined; sessions: KnownSessions }) {
	return (
		<tr className="relative h-10 border-b border-border/60 last:border-b-0 hover:bg-accent/50 has-[:focus-visible]:bg-accent/50">
			<td className="px-4">
				<a {...activityControl("projects.session.open")} href={hashForSession(id)} title={name} className="block truncate after:absolute after:inset-0 hover:underline">
					{name}
				</a>
			</td>
			<td className="px-3">
				<StatusBadge on={host !== null}>{host ? "Running" : "Ended"}</StatusBadge>
			</td>
			<td className="px-3 py-1.5 @max-lg:hidden">
				{pullRequests.length === 0 ? (
					<span className="text-xs text-muted-foreground">—</span>
				) : (
					<div className="relative z-1 flex flex-wrap gap-1">
						{pullRequests.map(pr => (
							<TodoLinkChip key={`${pr.owner}/${pr.repo}#${pr.number}`} link={{ kind: "pull-request", ...pr }} sessions={sessions} />
						))}
					</div>
				)}
			</td>
			<td className="px-4 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
				{lastLog ? (
					<time dateTime={lastLog}>
						<Age at={Date.parse(lastLog)} compact exact className="tabular-nums" /> ago
					</time>
				) : (
					"—"
				)}
			</td>
		</tr>
	);
}
