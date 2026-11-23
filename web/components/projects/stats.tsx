/** A project's stat strip: steps done, sessions running, linked work, and its last update. */
import { IconClock, IconFlag1 } from "central-icons";
import type { ReactNode } from "react";
import type { Thread } from "../../../src/shared/board";
import { age } from "../../labels";
import { PAGE_ICON } from "../../page-icons";
import { useMinute } from "../../use-minute";
import type { ProjectWork } from "./project-work";

const DAY = 24 * 60 * 60 * 1000;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ProjectStats({ plan, lastAt, work }: { plan: readonly Thread[]; lastAt: number | undefined; work: ProjectWork }) {
	const done = plan.filter(step => step.task === "done").length;
	const total = plan.length;
	const sessions = work.sessions.length;
	const linked = [work.pullRequests.length > 0 && plural(work.pullRequests.length, "pull request"), work.issues > 0 && plural(work.issues, "Linear issue")].filter(Boolean).join(" · ");
	const SessionsIcon = PAGE_ICON.sessions;
	const PullRequestsIcon = PAGE_ICON["pull-requests"];
	return (
		<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border @3xl:grid-cols-4">
			<Stat label="Steps done" icon={<IconFlag1 />} value={total === 0 ? "—" : <Fraction value={done} of={total} />}>
				{total === 0 ? "No steps yet" : done === total ? <Good>All done</Good> : `${total - done} left`}
			</Stat>
			<Stat label="Sessions running" icon={<SessionsIcon />} value={<Fraction value={work.running} of={sessions} />}>
				{work.running > 0 ? <Good>{work.running} running now</Good> : sessions === 0 ? "None started" : "None running"}
			</Stat>
			<Stat label="Linked work" icon={<PullRequestsIcon />} value={work.pullRequests.length + work.issues}>
				{linked || "Nothing linked yet"}
			</Stat>
			<LastUpdate at={lastAt} />
		</dl>
	);
}

/** The last update's age and whether the project moved today; both count up each minute. */
function LastUpdate({ at }: { at: number | undefined }) {
	const now = useMinute();
	const last = at ?? null;
	return (
		<Stat label="Last update" icon={<IconClock />} value={last === null ? "—" : `${age(last, { compact: true, now })} ago`}>
			{last === null ? "Nothing logged yet" : now - last < DAY ? <Good>Active today</Good> : <span className="text-destructive-foreground">Quiet for {age(last, { compact: true, now })}</span>}
		</Stat>
	);
}

/** A cell of the stat strip; the strip's background shows through the gaps between cells as their borders. */
function Stat({ label, icon, value, children }: { label: string; icon: ReactNode; value: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 bg-background px-4 py-3.5">
			<dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
				{icon}
				<span className="truncate">{label}</span>
			</dt>
			<dd className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</dd>
			<dd className="truncate text-xs leading-4 text-muted-foreground tabular-nums">{children}</dd>
		</div>
	);
}

function Good({ children }: { children: ReactNode }) {
	return <span className="text-success-foreground">{children}</span>;
}

function Fraction({ value, of }: { value: number; of: number }) {
	return (
		<>
			{value}
			<span className="text-base leading-none font-normal text-muted-foreground">/{of}</span>
		</>
	);
}
