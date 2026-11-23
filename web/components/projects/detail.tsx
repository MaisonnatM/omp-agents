/** The open project's page: a header to go back, archive it, or start a session in it; its name and goal to edit in place; its stat strip; its plan and sessions beside its decisions and recent activity. */
import { IconArchive, IconArrowLeft, IconArrowLoopDownLeft, IconPlusSmall } from "central-icons";
import { type ChangeEvent, type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { collapseSpaces } from "../../../src/shared/collapse-spaces";
import { type BoardState, channelName, planOf, type ProjectChannel } from "../../../src/shared/board";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import { listTime } from "../../labels";
import { hashForNewSession, hashForProject } from "../../routing";
import { PageFrame } from "../list-page";
import type { KnownSessions } from "../todo/links";
import { takeJustCreated } from "./new-project";
import { Decisions, RecentActivity } from "./notes";
import type { OnProjectChange } from "./parts";
import { Plan } from "./plan";
import { channelMessages, projectWork } from "./project-work";
import { SessionsTable } from "./sessions-table";
import { ProjectStats } from "./stats";

interface ProjectDetailProps {
	project: ProjectChannel;
	board: BoardState;
	sessions: KnownSessions;
	disabled: boolean;
	onChange: OnProjectChange;
}

export function ProjectDetail({ project: channel, board, sessions, disabled, onChange }: ProjectDetailProps) {
	const { project } = channel;
	const projectId = channel.id;
	const work = projectWork(project, sessions);
	const plan = planOf(board, projectId);
	const log = channelMessages(board, projectId);
	const archived = project.archivedAt !== undefined;
	const readOnly = disabled || archived;
	const name = useInlineDraft(channel.name, collapseSpaces, text => {
		if (text) onChange({ op: "rename", channel: projectId, name: channelName({ ...board, channels: board.channels.filter(each => each.id !== projectId) }, text) });
	});
	const goal = useInlineDraft(project.goal, text => text.trim(), text => onChange({ op: "set-goal", channel: projectId, goal: text }));
	const nameField = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (readOnly || !takeJustCreated(projectId)) return;
		nameField.current?.focus();
		nameField.current?.select();
	}, [projectId, readOnly]);
	return (
		<PageFrame
			title="Projects"
			meta={`${archived ? "Archived" : "Started"} ${listTime(project.archivedAt ?? project.createdAt)}`}
			leading={
				<Tooltip content="Back to Projects">
					<Button variant="ghost" size="icon-compact" aria-label="Back to Projects" className="text-muted-foreground" render={<a href={hashForProject(null)} />}>
						<IconArrowLeft />
					</Button>
				</Tooltip>
			}
			actions={
				<>
					<Tooltip content={archived ? "Restore the project to the sidebar" : "Archive the project: it leaves the sidebar and its sessions get no brief"}>
						<Button
							{...activityControl("projects.archive")}
							variant="outline"
							size="compact"
							leadingIcon={archived ? IconArrowLoopDownLeft : IconArchive}
							disabled={disabled}
							onClick={() => onChange({ op: "archive", channel: projectId, at: archived ? null : Date.now() })}
						>
							{archived ? "Restore" : "Archive"}
						</Button>
					</Tooltip>
					{!archived && (
						<Button
							{...activityControl("projects.session.new")}
							size="compact"
							leadingIcon={IconPlusSmall}
							disabled={disabled}
							render={disabled ? undefined : <a href={hashForNewSession({ projectId })} />}
						>
							New session
						</Button>
					)}
				</>
			}
		>
			<section aria-label={channel.name} className="@container min-w-0">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
					<div className="flex min-w-0 flex-col gap-1">
						<input
							{...activityControl("projects.name")}
							{...name}
							ref={nameField}
							aria-label="Name"
							readOnly={readOnly}
							className="-mx-1.5 min-w-0 rounded-md bg-transparent px-1.5 text-xl leading-snug font-semibold outline-none enabled:hover:bg-accent/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring read-only:hover:bg-transparent"
						/>
						<textarea
							{...activityControl("projects.goal")}
							{...goal}
							onKeyDown={event => event.key === "Escape" && goal.onKeyDown(event)}
							aria-label="Goal"
							rows={1}
							readOnly={readOnly}
							placeholder="Add a goal: what the project sets out to do, and when it is done"
							className="-mx-1.5 field-sizing-content max-w-prose resize-none rounded-md bg-transparent px-1.5 py-0.5 text-sm leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground hover:bg-accent/50 focus-visible:bg-background focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring read-only:hover:bg-transparent"
						/>
					</div>
					<ProjectStats plan={plan} lastAt={log.at(-1)?.at} work={work} />
					<div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
						<div className="flex min-w-0 flex-col gap-4">
							<Plan channel={channel} plan={plan} readOnly={readOnly} onChange={onChange} />
							<SessionsTable log={log} rows={work.sessions} sessions={sessions} archived={archived} />
						</div>
						<div className="flex min-w-0 flex-col gap-4">
							<Decisions channel={channel} readOnly={readOnly} onChange={onChange} />
							<RecentActivity channel={channel} board={board} log={log} sessions={sessions} readOnly={readOnly} onChange={onChange} />
						</div>
					</div>
				</div>
			</section>
		</PageFrame>
	);
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * A field that edits `value` in place: it holds your draft while it has focus, so a change from elsewhere neither resets
 * nor remounts it, and on leaving saves the draft, cleaned by `clean`, when it differs. Enter leaves; Escape drops the draft.
 */
function useInlineDraft(value: string, clean: (text: string) => string, save: (text: string) => void) {
	const [draft, setDraft] = useState<string | null>(null);
	const dropped = useRef(false);
	return {
		value: draft ?? value,
		onFocus: () => setDraft(value),
		onChange: (event: ChangeEvent<Field>) => setDraft(event.currentTarget.value),
		onKeyDown: (event: KeyboardEvent<Field>) => {
			if (event.key !== "Enter" && event.key !== "Escape") return;
			dropped.current = event.key === "Escape";
			event.currentTarget.blur();
		},
		onBlur: (event: FocusEvent<Field>) => {
			const text = clean(event.currentTarget.value);
			if (!dropped.current && text !== value) save(text);
			dropped.current = false;
			setDraft(null);
		},
	};
}
