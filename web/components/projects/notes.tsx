/** A project's Decisions and Recent activity cards: what was settled, and its log lines newest first. */
import { useState } from "react";
import type { Project } from "../../../src/shared/projects";
import { hashForSession } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Age } from "../age";
import { offerUndo } from "../toaster";
import { type KnownSessions, sessionLabel } from "../todo/links";
import { AddLine, Card, EmptyNote, type OnProjectChange, PROJECT_UNDO, RemoveButton } from "./parts";

/** Log lines Recent activity shows until **View all**. */
const RECENT = 8;

export function Decisions({ project, readOnly, onChange }: { project: Project; readOnly: boolean; onChange: OnProjectChange }) {
	const projectId = project.id;
	const remove = (text: string): void => {
		onChange({ op: "remove-decision", projectId, text });
		offerUndo(PROJECT_UNDO, `Removed “${text}”`, () => onChange({ op: "add-decision", projectId, text }));
	};
	return (
		<Card title="Decisions" meta={project.decisions.length > 0 ? String(project.decisions.length) : undefined}>
			{project.decisions.length === 0 ? (
				<EmptyNote>Record what was settled and why, so later sessions don't reopen it.</EmptyNote>
			) : (
				<ul className="flex flex-col px-4 py-1.5">
					{project.decisions.map(text => (
						<li key={text} className="group/item flex min-h-9 items-start gap-2.5 py-1.5 text-sm leading-snug">
							<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
							<span className="min-w-0 flex-1 break-words">{text}</span>
							{!readOnly && <RemoveButton control="projects.decision.remove" label={`Remove the decision “${text}”`} onClick={() => remove(text)} />}
						</li>
					))}
				</ul>
			)}
			{!readOnly && <AddLine control="projects.decision.add" label="Add a decision" onAdd={text => onChange({ op: "add-decision", projectId, text })} />}
		</Card>
	);
}

export function RecentActivity({ project, sessions, readOnly, onChange }: { project: Project; sessions: KnownSessions; readOnly: boolean; onChange: OnProjectChange }) {
	const [all, setAll] = useState(false);
	const newest = project.log.toReversed();
	const shown = all ? newest : newest.slice(0, RECENT);
	return (
		<Card
			title="Recent activity"
			action={
				newest.length > RECENT && (
					<Button variant="ghost" size="xs" onClick={() => setAll(!all)}>
						{all ? "Show fewer" : "View all"}
					</Button>
				)
			}
		>
			{newest.length === 0 ? (
				<EmptyNote>Sessions add a line here as they finish a step.</EmptyNote>
			) : (
				<ol className="flex flex-col px-4 py-1.5">
					{shown.map(entry => (
						<li key={`${entry.at}:${entry.sessionId ?? ""}:${entry.text}`} className="flex items-start gap-2.5 py-1.5 text-sm leading-snug">
							<p className="min-w-0 flex-1 break-words">
								{entry.sessionId ? (
									<a href={hashForSession(entry.sessionId)} className="font-medium hover:underline">
										{sessionLabel(entry.sessionId, sessions).name}
									</a>
								) : (
									<span className="font-medium">You</span>
								)}{" "}
								<span className="text-muted-foreground">{entry.text}</span>
							</p>
							<time dateTime={entry.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
								<Age at={Date.parse(entry.at)} compact exact className="tabular-nums" /> ago
							</time>
						</li>
					))}
				</ol>
			)}
			{!readOnly && <AddLine control="projects.log.add" label="Add a log line" onAdd={text => onChange({ op: "log", projectId: project.id, at: new Date().toISOString(), text })} />}
		</Card>
	);
}
