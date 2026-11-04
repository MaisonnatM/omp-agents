/** The New session page's starters: prompts for work you start often, their blanks filled and ranked by what the page knows now. */
import type { PullRequestSummary } from "../src/shared/github";
import type { Ticket } from "../src/shared/tickets";

/** What the page knows that fills a starter's blank or ranks it. */
export interface StarterContext {
	/** The draft directory's folder name. */
	folder: string;
	/** The branch checked out in the draft directory, `null` when unknown or detached. */
	branch: string | null;
	/** The Linear issues assigned to you. */
	tickets: readonly Ticket[];
	/** The pull requests the Pull requests page lists. */
	pullRequests: readonly PullRequestSummary[];
	/** How many pull requests wait on your move. */
	waiting: number;
	now: Date;
}

/** One starter: the pill's short label and the prompt it puts in the composer. */
export interface Starter {
	label: string;
	prompt: string;
}

const MONTH_MS = 30 * 86_400_000;
const TRUNKS = ["main", "master", "trunk"];

/** Every starter, its blanks filled from `ctx`, the best fit now first. */
export function rankedStarters(ctx: StarterContext): Starter[] {
	const day = ctx.now.getDay();
	const hour = ctx.now.getHours();
	const startOfWeek = day === 1 && hour < 14;
	const endOfWeek = (day === 5 && hour >= 15) || day === 6 || day === 0;
	const open = ctx.tickets.filter(ticket => ticket.statusType !== "completed" && ticket.statusType !== "canceled");
	const started = open.find(ticket => ticket.statusType === "started");
	const queued = open.find(ticket => ticket.statusType === "unstarted" || ticket.statusType === "triage");
	const issue = started ?? queued;
	const stale = open.filter(ticket => Date.parse(ticket.updatedAt) < ctx.now.getTime() - MONTH_MS).length;
	const mine = ctx.pullRequests.filter(pr => pr.role === "author" && pr.state !== "merged");
	const only = mine.length === 1 ? mine[0] : null;
	const onFeature = ctx.branch !== null && !TRUNKS.includes(ctx.branch);
	const ranked = [
		{ score: onFeature ? 60 : 20, label: "Run the dev server", prompt: `Start the dev server on ${ctx.branch ?? "this branch"} and give me the URL` },
		// `/ship ` with no issue waits for the issue's or the view's link pasted after it.
		{ score: started ? 70 : queued ? 50 : 15, label: issue ? `Ship ${issue.id}` : "Ship a Linear issue", prompt: `/ship ${issue?.id ?? ""}` },
		{
			score: Math.min(90, 25 + ctx.waiting * 20 + mine.length * 3),
			label: only ? `Shepherd #${only.number}` : "Shepherd my PRs",
			prompt: `Shepherd ${only ? `PR ${only.owner}/${only.repo}#${only.number}` : "my open PRs"} until merged: rebase, fix CI, answer review threads`,
		},
		{
			score: startOfWeek || endOfWeek ? 100 : 10,
			label: startOfWeek ? "Sum up last week" : "Sum up my week",
			prompt: `Summarize what I merged ${startOfWeek ? "last" : "this"} week across my repos`,
		},
		{ score: stale >= 5 ? 55 : 12, label: "Prune Linear todos", prompt: "Review my Linear todos for staleness and propose what to close" },
		{ score: hour < 10 ? 40 : 14, label: "Update omp + pstack", prompt: "Update omp and check pstack is on its latest version" },
		{ score: 5, label: "Who changed this checkout", prompt: `Find which session made the uncommitted changes in ${ctx.folder}` },
	];
	return ranked.toSorted((a, b) => b.score - a.score).map(({ label, prompt }) => ({ label, prompt }));
}
