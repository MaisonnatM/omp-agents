/**
 * Watches what each project subscribes to and tells its coordinator what changed: its workers' pull requests (checks
 * that start failing, new comments and reviews, a merge or a close) and the viewer's Linear issues that match its filter
 * (new ones, and ones that changed). The first look at each only records it, so a dashboard start reports nothing old;
 * what changed while the dashboard was down is therefore not reported.
 */
import { errorText } from "../json";
import { type LinkedPullRequest, type PullRequest, type PullRequestDetail, pullRequestName, samePullRequest } from "../shared/github";
import type { LinearFilter, Project, ProjectEvent } from "../shared/projects";
import type { Ticket } from "../shared/tickets";

/** How many minutes pass between two looks. */
const PROJECT_WATCH_MINUTES = 2;
/** How long a quoted comment may be in an update. */
const COMMENT_QUOTE_CHARS = 300;

export interface ProjectWatchDeps {
	projects(): readonly Project[];
	/** The pull requests session `sessionId` submitted or worked on. */
	pullRequestsOf(sessionId: string): LinkedPullRequest[];
	/** Pull request `pr` read from GitHub now. */
	detail(pr: PullRequest): Promise<PullRequestDetail>;
	/** The viewer's assigned Linear issues, read now. */
	tickets(): Promise<Ticket[]>;
	/** Saves `event` for project `projectId`'s coordinator; why it cannot, or `null` once saved. */
	notify(projectId: string, event: ProjectEvent): string | null;
}

/** What a pull request looked like at the last look. */
interface PullRequestSeen {
	state: PullRequestDetail["state"];
	checks: PullRequestDetail["checks"];
	/** The time of the newest comment or review, in ms. */
	lastEvent: number;
}

/** Whether `ticket` matches every field `filter` names, case aside. */
export function matchesFilter(ticket: Ticket, filter: LinearFilter): boolean {
	const same = (a: string | null, b: string | null): boolean => a === null || (b !== null && a.trim().toLowerCase() === b.trim().toLowerCase());
	return same(filter.team, ticket.team) && same(filter.project, ticket.project) && (filter.label === null || ticket.labels.some(label => same(filter.label, label.name)));
}

/** The news in `now` against `seen`, the same pull request at the last look; none at the first. */
export function pullRequestNews(seen: PullRequestSeen | undefined, now: PullRequestDetail): { title: string; text: string }[] {
	if (!seen) return [];
	const name = pullRequestName(now);
	const news: { title: string; text: string }[] = [];
	if (now.state !== seen.state && (now.state === "merged" || now.state === "closed")) news.push({ title: `${name} was ${now.state}`, text: now.title });
	if (now.checks === "failing" && seen.checks !== "failing") {
		const failing = now.checkRuns.filter(check => check.state === "failing").map(check => check.name);
		news.push({ title: `Checks failed on ${name}`, text: failing.length > 0 ? `Failing: ${failing.join(", ")}` : now.title });
	}
	if (now.checks === "passing" && seen.checks === "failing") news.push({ title: `Checks pass again on ${name}`, text: now.title });
	for (const event of now.conversation.filter(candidate => candidate.at > seen.lastEvent)) {
		const what = event.review === null ? "commented" : event.review === "changes-requested" ? "requested changes" : event.review;
		const body = event.body.trim();
		news.push({ title: `${event.author.login} ${what} on ${name}`, text: body.length > COMMENT_QUOTE_CHARS ? `${body.slice(0, COMMENT_QUOTE_CHARS)}…` : body });
	}
	return news;
}

export class ProjectWatch {
	readonly #deps: ProjectWatchDeps;
	/** By pull request name. */
	readonly #pullRequests = new Map<string, PullRequestSeen>();
	/** Each project's matching issues by identifier, with their last update time. */
	readonly #tickets = new Map<string, Map<string, string>>();
	#running = false;
	/** Minutes since the last look. */
	#minutes = 0;

	constructor(deps: ProjectWatchDeps) {
		this.#deps = deps;
	}

	/** A minute passed: every {@link PROJECT_WATCH_MINUTES}, looks at what every project not archived watches; a look while one runs is skipped. */
	async tick(): Promise<void> {
		if (++this.#minutes < PROJECT_WATCH_MINUTES || this.#running) return;
		this.#minutes = 0;
		this.#running = true;
		try {
			const projects = this.#deps.projects().filter(project => !project.archived);
			await this.#watchPullRequests(projects.filter(project => project.watch.pullRequests));
			await this.#watchTickets(projects.filter(project => project.watch.linear !== null));
		} finally {
			this.#running = false;
		}
	}

	async #watchPullRequests(projects: Project[]): Promise<void> {
		for (const project of projects) {
			const pullRequests: LinkedPullRequest[] = [];
			for (const worker of project.workers) for (const pr of this.#deps.pullRequestsOf(worker.sessionId)) if (!pullRequests.some(seen => samePullRequest(seen, pr))) pullRequests.push(pr);
			for (const pr of pullRequests) {
				const name = pullRequestName(pr);
				const seen = this.#pullRequests.get(name);
				// A pull request merged or closed before has nothing left to report.
				if (seen && (seen.state === "merged" || seen.state === "closed")) continue;
				const detail = await this.#deps.detail(pr).catch((error: unknown) => {
					console.error(`omp-agents: cannot read ${name} for project ${project.name}: ${errorText(error)}`);
					return null;
				});
				if (!detail) continue;
				for (const news of pullRequestNews(seen, detail)) this.#deps.notify(project.id, { source: "GitHub", ...news, url: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}` });
				this.#pullRequests.set(name, { state: detail.state, checks: detail.checks, lastEvent: Math.max(0, ...detail.conversation.map(event => event.at)) });
			}
		}
	}

	async #watchTickets(projects: Project[]): Promise<void> {
		if (projects.length === 0) return;
		const tickets = await this.#deps.tickets().catch((error: unknown) => {
			console.error(`omp-agents: cannot read Linear for projects: ${errorText(error)}`);
			return null;
		});
		if (!tickets) return;
		for (const project of projects) {
			const filter = project.watch.linear!;
			const matching = tickets.filter(ticket => matchesFilter(ticket, filter));
			const seen = this.#tickets.get(project.id);
			if (seen) {
				for (const ticket of matching) {
					const before = seen.get(ticket.id);
					if (before === ticket.updatedAt) continue;
					const title = before === undefined ? `New Linear issue ${ticket.id}: ${ticket.title}` : `${ticket.id} changed: ${ticket.title}`;
					this.#deps.notify(project.id, { source: "Linear", title, text: `Status: ${ticket.status}`, url: ticket.url });
				}
			}
			this.#tickets.set(project.id, new Map(matching.map(ticket => [ticket.id, ticket.updatedAt])));
		}
	}
}
