/**
 * Watches what each project subscribes to and tells its coordinator what changed: its workers' pull requests (checks
 * that start failing, new comments and reviews, a merge or a close) and the viewer's Linear issues that match its filter
 * (new ones, and ones that changed). The first look at each only records it, so a dashboard start reports nothing old;
 * what changed while the dashboard was down is therefore not reported. A merge it sees ends the workers it leaves with
 * nothing to do, by the rule the cleanup after a merge applies to every other session, and the merge's update says so.
 */
import { errorText } from "../json";
import { type LinkedPullRequest, type PullRequest, type PullRequestDetail, pullRequestName, samePullRequest } from "../shared/github";
import type { LinearFilter, Project, ProjectEvent, Worker, WorkerId } from "../shared/projects";
import type { Ticket } from "../shared/tickets";
import { finishedSessions } from "./merge-cleanup";

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
	/** Whether session `sessionId` runs and is idle. */
	idle(sessionId: string): boolean;
	/** Ends worker `workerId` of project `projectId` when it runs and is idle; whether it began to. */
	endIdle(projectId: string, workerId: WorkerId): boolean;
}

/** One change to report on a pull request; `merged` marks its merge. */
type News = { title: string; text: string; merged?: true };

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
export function pullRequestNews(seen: PullRequestSeen | undefined, now: PullRequestDetail): News[] {
	if (!seen) return [];
	const name = pullRequestName(now);
	const news: News[] = [];
	if (now.state !== seen.state && (now.state === "merged" || now.state === "closed")) {
		news.push({ title: `${name} was ${now.state}`, text: now.title, ...(now.state === "merged" ? { merged: true as const } : {}) });
	}
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
			const linked = new Map(project.workers.map(worker => [worker, this.#deps.pullRequestsOf(worker.sessionId)]));
			const pullRequests: LinkedPullRequest[] = [];
			for (const prs of linked.values()) for (const pr of prs) if (!pullRequests.some(seen => samePullRequest(seen, pr))) pullRequests.push(pr);
			const found: { pr: LinkedPullRequest; news: News[] }[] = [];
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
				found.push({ pr, news: pullRequestNews(seen, detail) });
				this.#pullRequests.set(name, { state: detail.state, checks: detail.checks, lastEvent: Math.max(0, ...detail.conversation.map(event => event.at)) });
			}
			const ended = this.#endFinished(project.id, linked, found.filter(({ news }) => news.some(item => item.merged)).map(({ pr }) => pr));
			for (const { pr, news } of found) {
				for (const { title, text, merged } of news) {
					const gone = merged ? ended.filter(([, prs]) => prs.some(other => samePullRequest(other, pr))).map(([worker]) => `${worker.id} ${JSON.stringify(worker.title)}`) : [];
					const said = gone.length > 0 ? `${text}\nEnded ${gone.join(", ")}: idle, with every pull request merged or closed.` : text;
					this.#deps.notify(project.id, { source: "GitHub", title, text: said, url: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}` });
				}
			}
		}
	}

	/**
	 * Ends each worker that a merge of `merged`, since the last look, leaves with nothing to do, by the rule every session
	 * follows ({@link finishedSessions}); the ones it began to end, with their pull requests.
	 */
	#endFinished(projectId: string, linked: Map<Worker, LinkedPullRequest[]>, merged: LinkedPullRequest[]): [Worker, LinkedPullRequest[]][] {
		const settled = (pr: PullRequest): boolean => {
			const state = this.#pullRequests.get(pullRequestName(pr))?.state;
			return state === "merged" || state === "closed";
		};
		const workers = [...linked].map(([worker, pullRequests]) => ({ worker, sessionId: worker.sessionId, idle: this.#deps.idle(worker.sessionId), pullRequests }));
		return finishedSessions(workers, merged, settled).flatMap(({ worker, pullRequests }) => (this.#deps.endIdle(projectId, worker.id) ? [[worker, pullRequests] as [Worker, LinkedPullRequest[]]] : []));
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
