/** The header's **What's new**: the features of the running omp-agents build, and those **Update dashboard** would load. */
import { Download, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { ChangelogEntry, DashboardChangelog } from "../../src/shared/dashboard-update";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { updateDashboard } from "../dashboard-update";
import { DAY_FORMAT } from "../labels";
import { useRead } from "../reads";
import { useStoredState } from "../stored-state";

const SEEN_KEY = "omp-agents.whats-new-seen";
/** The commit time, in ms, of the newest feature the popover showed on this machine; `0` before it ever opened. */
const decodeSeen = (raw: string | null): number => (raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : 0);

/** `entries` in runs of one local day each, newest first, as the log lists them. */
function byDay(entries: ChangelogEntry[]): [string, ChangelogEntry[]][] {
	const days = new Map<string, ChangelogEntry[]>();
	for (const entry of entries) {
		const day = DAY_FORMAT.format(entry.at);
		days.set(day, [...(days.get(day) ?? []), entry]);
	}
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
					<li key={entry.commit} className="flex items-baseline gap-2 rounded-lg px-3 py-1.5 hover:bg-muted/70">
						<span className="min-w-0 flex-1 text-[13px]">{entry.title}</span>
						{entry.area && <Badge color="gray">{entry.area}</Badge>}
						{entry.pr !== null && <span className="text-xs tabular-nums text-muted-foreground">#{entry.pr}</span>}
					</li>
				))}
			</ul>
		</section>
	);
}

function Body({ changelog }: { changelog: DashboardChangelog }) {
	if (changelog.kind === "unavailable") return <p className="px-3 py-4 text-sm text-muted-foreground">What's new reads the git history omp-agents runs from. {changelog.reason}</p>;
	const pending = changelog.entries.filter(entry => !entry.installed);
	const installed = changelog.entries.filter(entry => entry.installed);
	return (
		<>
			{pending.length > 0 && (
				<Group
					title={`Not loaded yet, on origin/${changelog.branch}`}
					entries={pending}
					action={
						<Button size="compact" leadingIcon={Download} onClick={() => void updateDashboard()}>
							Update dashboard
						</Button>
					}
				/>
			)}
			{installed.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No feature commits on {changelog.branch} yet.</p>}
			{byDay(installed).map(([day, entries]) => (
				<Group key={day} title={day} entries={entries} />
			))}
		</>
	);
}

export function WhatsNew() {
	const [open, setOpen] = useState(false);
	// Read at load for the dot, and again at each open, so the list follows the last fetch without polling.
	const [opens, setOpens] = useState(0);
	const read = useRead<DashboardChangelog>("/api/dashboard/changelog", opens);
	const [seen, setSeen] = useStoredState(SEEN_KEY, decodeSeen);
	const entries = read.data?.kind === "checkout" ? read.data.entries : [];
	const newest = Math.max(0, ...entries.map(entry => entry.at));
	const unseen = newest > seen;
	useEffect(() => {
		if (open && newest > 0) setSeen(last => Math.max(last, newest));
	}, [open, newest, setSeen]);
	const toggle = (next: boolean): void => {
		setOpen(next);
		if (next) setOpens(count => count + 1);
	};
	return (
		<Popover open={open} onOpenChange={toggle}>
			<Tooltip content="What's new" side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button {...activityControl("header.whats-new")} variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label={unseen ? "What's new, unseen features" : "What's new"} data-state={open ? "open" : "closed"} active={open}>
						<Sparkles />
						{unseen && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-blue-500 ring-2 ring-background" />}
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent align="end" className="flex max-h-[min(560px,80vh)] w-[420px] flex-col p-0">
				<header className="border-b px-3 pt-3 pb-2">
					<h2 className="text-sm font-semibold">What's new</h2>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto p-1">
					{read.error ? (
						<p className="px-3 py-4 text-sm text-destructive">Cannot read the changelog: {read.error}</p>
					) : read.data ? (
						<Body changelog={read.data} />
					) : (
						<p className="px-3 py-4 text-sm text-muted-foreground">Reading the changelog…</p>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
