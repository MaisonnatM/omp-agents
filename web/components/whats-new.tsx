/** The What's new page: the lines of `CHANGELOG.md` in the running omp-agents build, and those **Update dashboard** would load. */
import { IconArrowInbox } from "central-icons";
import { type ReactNode, useEffect } from "react";
import type { ChangelogEntry, DashboardChangelog } from "../../src/shared/dashboard-update";
import { Button } from "@/components/ui/button";
import { updateDashboard } from "../dashboard-update";
import { dateLabel } from "../labels";
import { useRead } from "../reads";
import { useStoredState } from "../stored-state";
import { PageFrame } from "./list-page";

const SEEN_KEY = "omp-agents.whats-new-seen-lines";
/** How many lines the page listed when it last opened on this machine; `0` before it ever opened. */
const decodeSeen = (raw: string | null): number => (raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : 0);

/** `entries` in runs of one day each, newest first, as the server orders them. */
function byDay(entries: ChangelogEntry[]): [string, ChangelogEntry[]][] {
	const days = new Map<string, ChangelogEntry[]>();
	for (const entry of entries) days.set(entry.day, [...(days.get(entry.day) ?? []), entry]);
	return [...days];
}

function Group({ title, entries, action }: { title: string; entries: ChangelogEntry[]; action?: ReactNode }) {
	return (
		<section aria-label={title}>
			<div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
				<h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
				{action}
			</div>
			<ul className="flex flex-col">
				{entries.map(entry => (
					<li key={`${entry.day} ${entry.text}`} className="rounded-lg px-3 py-1.5 text-[13px] hover:bg-muted/70">
						{entry.text}
					</li>
				))}
			</ul>
		</section>
	);
}

function Body({ changelog }: { changelog: DashboardChangelog }) {
	if (changelog.kind === "unavailable") return <p className="px-3 py-4 text-sm text-muted-foreground">What's new reads CHANGELOG.md from the git checkout omp-agents runs from. {changelog.reason}</p>;
	const pending = changelog.entries.filter(entry => !entry.installed);
	const installed = changelog.entries.filter(entry => entry.installed);
	return (
		<>
			{pending.length > 0 && (
				<Group
					title={`Not loaded yet, on origin/${changelog.branch}`}
					entries={pending}
					action={
						<Button size="compact" leadingIcon={IconArrowInbox} onClick={() => void updateDashboard()}>
							Update dashboard
						</Button>
					}
				/>
			)}
			{installed.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nothing new on {changelog.branch} yet.</p>}
			{byDay(installed).map(([day, entries]) => (
				<Group key={day} title={dateLabel(day)} entries={entries} />
			))}
		</>
	);
}

const CHANGELOG_URL = "/api/dashboard/changelog";

/** The changelog has more lines than the page listed when it last opened on this machine, read once as the page loads. */
export function useUnseenChangelog(): boolean {
	const read = useRead<DashboardChangelog>(CHANGELOG_URL, 0);
	const [seen] = useStoredState(SEEN_KEY, decodeSeen);
	return read.data?.kind === "checkout" && read.data.entries.length > seen;
}

export function WhatsNewPage() {
	const read = useRead<DashboardChangelog>(CHANGELOG_URL, 0);
	const [, setSeen] = useStoredState(SEEN_KEY, decodeSeen);
	const count = read.data?.kind === "checkout" ? read.data.entries.length : 0;
	useEffect(() => {
		if (count > 0) setSeen(count);
	}, [count, setSeen]);
	return (
		<PageFrame title="What's new" meta="What changed in omp-agents, newest day first">
			<div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-2 pb-8">
				{read.error ? (
					<p className="px-3 py-4 text-sm text-destructive">Cannot read the changelog: {read.error}</p>
				) : read.data ? (
					<Body changelog={read.data} />
				) : (
					<p className="px-3 py-4 text-sm text-muted-foreground">Reading the changelog…</p>
				)}
			</div>
		</PageFrame>
	);
}
