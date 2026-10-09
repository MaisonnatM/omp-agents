import { CircleCheck, CircleDashed, CircleSlash, CircleX, type LucideIcon } from "lucide-react";
import type { CheckRunState, PullRequestCheck } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const CHECK_RUN_ICON: Record<CheckRunState, [LucideIcon, string]> = {
	failing: [CircleX, "text-red-600 dark:text-red-400"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400"],
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
	skipped: [CircleSlash, "text-muted-foreground"],
};

/** Each state's share of the checks bar, in this order. */
const CHECK_BAR: Record<CheckRunState, string> = {
	failing: "bg-red-500",
	pending: "bg-amber-500",
	passing: "bg-emerald-500",
	skipped: "bg-muted-foreground/30",
};

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const [Icon, color] = CHECK_RUN_ICON[state];
	return (
		<li className="flex min-w-0 items-center gap-2">
			<Icon aria-label={state} className={cn("size-3.5 shrink-0", color)} />
			{url ? (
				<Tooltip content={name}>
					<a href={url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
						{name}
					</a>
				</Tooltip>
			) : (
				<Tooltip content={name}>
					<span className="truncate">{name}</span>
				</Tooltip>
			)}
		</li>
	);
}

/** A bar of the checks' states, then failing and pending checks in full; passing and skipped ones folded behind their counts. */
function Checks({ checks }: { checks: PullRequestCheck[] }) {
	const waiting = checks.filter(check => check.state === "failing" || check.state === "pending");
	const settled = checks.filter(check => check.state === "passing" || check.state === "skipped");
	const passing = settled.filter(check => check.state === "passing").length;
	const skipped = settled.length - passing;
	const counts = Map.groupBy(checks, check => check.state);
	return (
		<div className="space-y-2 text-xs">
			<div aria-hidden className="flex h-1 gap-px overflow-hidden rounded-full">
				{(Object.keys(CHECK_BAR) as CheckRunState[]).map(state => {
					const count = counts.get(state)?.length ?? 0;
					return count > 0 && <span key={state} className={CHECK_BAR[state]} style={{ flexGrow: count }} />;
				})}
			</div>
			{waiting.length > 0 && (
				<ul className="space-y-1">
					{waiting.map((check, index) => (
						// GitHub can name two runs alike.
						<CheckRow key={index} check={check} />
					))}
				</ul>
			)}
			{settled.length > 0 && (
				<details>
					<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
						{[passing > 0 && `${passing} passing`, skipped > 0 && `${skipped} skipped`].filter(Boolean).join(", ")}
					</summary>
					<ul className="mt-1.5 space-y-1">
						{settled.map((check, index) => (
							<CheckRow key={index} check={check} />
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

/** The checks at a glance on the tab bar's right, with the full list in a popover. */
export function ChecksSummary({ checks }: { checks: PullRequestCheck[] }) {
	if (checks.length === 0) return null;
	const count = (state: CheckRunState): number => checks.filter(check => check.state === state).length;
	const failing = count("failing");
	const pending = count("pending");
	const [Icon, color, text] =
		failing > 0
			? [CircleX, CHECK_RUN_ICON.failing[1], `${failing} of ${checks.length} failing`]
			: pending > 0
				? [CircleDashed, CHECK_RUN_ICON.pending[1], `${pending} of ${checks.length} running`]
				: [CircleCheck, CHECK_RUN_ICON.passing[1], `${checks.length} passing`];
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" className="text-muted-foreground" aria-label={`Checks: ${text}`}>
					<span className="flex items-center gap-1.5">
						<Icon aria-hidden className={cn("size-4", color)} />
						<span className="hidden tabular-nums @sm/pr:inline">{text}</span>
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-3">
				<Checks checks={checks} />
			</PopoverContent>
		</Popover>
	);
}
