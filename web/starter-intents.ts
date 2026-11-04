/** Prototype: the recurring intents behind the New session page's starters, resolved against what the page knows now. */
import type { PullRequestList, PullRequestSummary } from "../src/shared/github";
import type { Ticket } from "../src/shared/tickets";

export type IntentId = "dev-server" | "ship" | "shepherd" | "week" | "prune" | "update" | "who-changed";

/** What the page knows that fills an intent's slot or ranks it. */
export interface StarterContext {
	/** The draft directory's folder name. */
	folder: string;
	/** The branch checked out in the draft directory, `null` when unknown or detached. */
	branch: string | null;
	/** Local branches, the checked-out one first. */
	branches: string[];
	/** Linear issues assigned to you, not done. */
	tickets: Ticket[];
	/** Your own open pull requests. */
	mine: PullRequestSummary[];
	/** Pull requests whose next move is yours. */
	waiting: number;
	now: Date;
}

/** A choice an intent's prompt takes, such as the branch or the Linear issue; the first option is the default. */
export interface Slot {
	name: string;
	options: { value: string; label: string; hint?: string }[];
}

export interface Intent {
	id: IntentId;
	label: string;
	/** What the page knows that makes it relevant now: `3 wait on you`, `board-starters`. */
	detail: string | null;
	/** Why it ranks where it does, for the hero and the ghost prompt: `Monday morning`. */
	reason: string | null;
	/** How much it fits now; higher first. */
	score: number;
	slot: Slot | null;
	/** The prompt for one slot value, the slot's first option when omitted. */
	prompt: (value?: string) => string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function partOfDay(now: Date): string {
	const hour = now.getHours();
	return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every intent, its slot filled and its score set from `ctx`, highest score first. */
export function rankIntents(ctx: StarterContext): Intent[] {
	const day = ctx.now.getDay();
	const hour = ctx.now.getHours();
	const when = `${DAYS[day]} ${partOfDay(ctx.now)}`;
	const startOfWeek = day === 1 && hour < 14;
	const endOfWeek = (day === 5 && hour >= 15) || day === 6 || day === 0;
	const started = ctx.tickets.filter(ticket => ticket.statusType === "started");
	const queued = ctx.tickets.filter(ticket => ticket.statusType === "unstarted" || ticket.statusType === "triage");
	const shipCandidates = [...started, ...queued];
	const monthAgo = ctx.now.getTime() - 30 * 86_400_000;
	const stale = ctx.tickets.filter(ticket => Date.parse(ticket.updatedAt) < monthAgo).length;
	const onFeature = ctx.branch !== null && !["main", "master", "trunk"].includes(ctx.branch);
	const intents: Intent[] = [
		{
			id: "dev-server",
			label: "Run the dev server",
			detail: ctx.branch ? `on ${ctx.branch}` : null,
			reason: onFeature ? `You're on ${ctx.branch}` : null,
			score: onFeature ? 60 : 20,
			slot: ctx.branches.length ? { name: "branch", options: ctx.branches.slice(0, 6).map(name => ({ value: name, label: name })) } : null,
			prompt: (branch = ctx.branch ?? undefined) => `Start the dev server on ${branch ?? "this branch"} and give me the URL`,
		},
		{
			id: "ship",
			label: "Ship a Linear issue",
			detail: started.length ? `${plural(started.length, "issue")} in progress` : queued.length ? `${plural(queued.length, "issue")} up next` : null,
			reason: started[0] ? `${started[0].id} is in progress` : queued[0] ? `${queued[0].id} is up next` : null,
			score: started.length ? 70 : queued.length ? 50 : 15,
			slot: shipCandidates.length ? { name: "issue", options: shipCandidates.slice(0, 6).map(ticket => ({ value: ticket.id, label: ticket.id, hint: ticket.title })) } : null,
			prompt: (id = shipCandidates[0]?.id) => `/ship ${id ?? ""}`,
		},
		{
			id: "shepherd",
			label: "Shepherd my pull requests",
			detail: ctx.mine.length || ctx.waiting ? `${ctx.mine.length} open · ${ctx.waiting} wait on you` : null,
			reason: ctx.waiting ? `${plural(ctx.waiting, "pull request")} ${ctx.waiting === 1 ? "waits" : "wait"} on you` : null,
			score: Math.min(90, 25 + ctx.waiting * 20 + ctx.mine.length * 3),
			slot: { name: "scope", options: [{ value: "all", label: `all ${ctx.mine.length}` }, ...ctx.mine.slice(0, 5).map(pr => ({ value: `#${pr.number}`, label: `#${pr.number}`, hint: pr.title }))] },
			prompt: (scope = "all") =>
				scope === "all"
					? "Shepherd my open PRs until merged: rebase, fix CI, answer review threads"
					: `Shepherd PR ${scope} until merged: rebase, fix CI, answer review threads`,
		},
		{
			id: "week",
			label: startOfWeek ? "Sum up last week" : "Sum up my week",
			detail: startOfWeek ? "last week" : "this week so far",
			reason: startOfWeek ? "Monday morning" : endOfWeek ? "The week is ending" : null,
			score: startOfWeek || endOfWeek ? 100 : 10,
			slot: { name: "week", options: startOfWeek ? [{ value: "last", label: "last week" }, { value: "this", label: "this week" }] : [{ value: "this", label: "this week" }, { value: "last", label: "last week" }] },
			prompt: (week = startOfWeek ? "last" : "this") => `Summarize what I merged ${week} week across my repos`,
		},
		{
			id: "prune",
			label: "Prune my Linear todos",
			detail: ctx.tickets.length ? `${ctx.tickets.length} assigned · ${stale} untouched 30d+` : null,
			reason: stale >= 5 ? `${plural(stale, "issue")} untouched for a month` : null,
			score: stale >= 5 ? 55 : 12,
			slot: null,
			prompt: () => "Review my Linear todos for staleness and propose what to close",
		},
		{
			id: "update",
			label: "Update omp and pstack",
			detail: "omp · pstack",
			reason: hour < 10 ? "Start the day on the latest omp" : null,
			score: hour < 10 ? 40 : 14,
			slot: null,
			prompt: () => "Update omp and check pstack is on its latest version",
		},
		{
			id: "who-changed",
			label: "Find who changed this checkout",
			detail: ctx.folder,
			reason: null,
			score: 5,
			slot: null,
			prompt: () => `Find which session made the uncommitted changes in ${ctx.folder}`,
		},
	];
	return intents.toSorted((a, b) => b.score - a.score);
}

/** Your own open pull requests across every repository the list holds. */
export function ownOpenPullRequests(list: PullRequestList | null): PullRequestSummary[] {
	if (!list) return [];
	return list.repos.flatMap(repo => ("pullRequests" in repo ? repo.pullRequests : [])).filter(pr => pr.role === "author" && pr.state !== "merged");
}
