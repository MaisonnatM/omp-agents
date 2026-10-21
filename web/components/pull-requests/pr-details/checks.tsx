import { CircleCheck, CircleDot, CircleSlash, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { CheckRunState, PullRequestCheck } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ChecksPresentation, presentChecks } from "../../../pull-request-checks";

const CHECK_RUN: Record<CheckRunState, { Icon: LucideIcon; color: string; label: string }> = {
	failing: { Icon: CircleX, color: "text-destructive", label: "Failed" },
	pending: { Icon: LoaderCircle, color: "text-amber-500 motion-safe:animate-spin", label: "Running" },
	passing: { Icon: CircleCheck, color: "text-emerald-600 dark:text-emerald-300/90", label: "Passed" },
	skipped: { Icon: CircleSlash, color: "text-muted-foreground/70", label: "Skipped" },
};

const CHECKS_STATE = {
	failing: CHECK_RUN.failing,
	pending: { Icon: CircleDot, color: "text-amber-600 dark:text-amber-400/90" },
	passing: CHECK_RUN.passing,
	none: { Icon: CircleDot, color: "text-muted-foreground" },
};

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const { Icon, color, label } = CHECK_RUN[state];
	return (
		<li className="col-span-full grid grid-cols-subgrid items-center text-xs">
			<Icon aria-hidden className={cn("size-3.5 shrink-0", color)} />
			<Tooltip content={name}>
				<span className="min-w-0 truncate">{name}</span>
			</Tooltip>
			<span className="justify-self-end whitespace-nowrap text-muted-foreground">{label}</span>
			{url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Details for ${name}`} className="text-primary hover:underline">Details</a>}
		</li>
	);
}

function Checks({ summary }: { summary: ChecksPresentation }) {
	const [showAll, setShowAll] = useState(false);
	const { attention, running, completed } = summary;
	const canCollapse = attention.length + running.length > 0 && completed.length > 0;
	const visible = [...attention, ...running, ...(showAll || !canCollapse ? completed : [])];
	const hasDetails = visible.some(check => check.url !== null);
	return (
		<>
			<div className="-mr-3 max-h-64 overflow-y-auto">
				<ul className={cn("grid gap-x-2 gap-y-1 pr-3", hasDetails ? "grid-cols-[auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]")}>
					{visible.map((check, index) => <CheckRow key={`${index}:${check.name}`} check={check} />)}
				</ul>
			</div>
			{canCollapse && <Button variant="ghost" size="xs" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "Show all"}</Button>}
		</>
	);
}

export function ChecksSummary({ checks }: { checks: PullRequestCheck[] }) {
	const summary = presentChecks(checks);
	const { Icon, color } = CHECKS_STATE[summary.state];
	return (
		<span className="ml-auto flex h-4 min-w-0 flex-1 flex-wrap content-start items-center justify-end gap-x-1.5 overflow-hidden text-xs text-muted-foreground">
			{summary.state === "none" ? <Icon aria-hidden className="size-3.5 shrink-0" /> : (
				<Popover>
					<PopoverTrigger asChild>
						<button type="button" aria-label={`Checks: ${summary.text}`} className="relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring after:absolute after:size-6">
							<Icon aria-hidden className={cn("size-3.5", color)} />
						</button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3">
						<p className="text-sm font-medium">{summary.heading}</p>
						<p className="text-xs text-muted-foreground">{summary.text}</p>
						<Checks summary={summary} />
					</PopoverContent>
				</Popover>
			)}
			<span className="whitespace-nowrap tabular-nums @max-[30rem]/pr:sr-only">{summary.text}</span>
		</span>
	);
}
