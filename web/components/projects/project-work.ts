/** What a project's sessions are and touched, which its page sums up. */
import { type PullRequest, uniquePullRequests } from "../../../src/shared/github";
import type { Project } from "../../../src/shared/projects";
import type { RosterHost } from "../../../src/shared/sessions";
import { hostLabel, pastLabel } from "../../labels";
import type { KnownSessions } from "../todo/links";

/** A session of a project, read once from the roster: its live host while it runs, else its saved copy, or neither once the dashboard forgets it. */
export interface ProjectSession {
	id: string;
	name: string;
	/** Its live host; `null` once it ended. */
	host: RosterHost | null;
	pullRequests: PullRequest[];
}

export interface ProjectWork {
	/** Its sessions, the running ones first, each part in the project's order. */
	sessions: ProjectSession[];
	running: number;
	/** The pull requests its sessions link, each once. */
	pullRequests: PullRequest[];
	/** How many Linear issues its sessions link, each counted once. */
	issues: number;
}

/** {@link ProjectWork} of `project`, from every live and past session; a session still live is read from the roster, not from its saved copy. */
export function projectWork(project: Project, { hosts, past }: KnownSessions): ProjectWork {
	const live = new Map(hosts.map(host => [host.sessionId, host]));
	const saved = new Map(past.map(session => [session.sessionId, session]));
	const issues = new Set<string>();
	const sessions = project.sessionIds.map((id): ProjectSession => {
		const host = live.get(id) ?? null;
		const copy = host ? undefined : saved.get(id);
		const facts = host ?? copy;
		for (const issue of facts?.issues ?? []) issues.add(issue);
		const name = host ? hostLabel(host) : copy ? pastLabel(copy) : "Session";
		return { id, name, host, pullRequests: uniquePullRequests(facts?.pullRequests ?? []) };
	});
	const running = sessions.filter(session => session.host !== null);
	return {
		sessions: [...running, ...sessions.filter(session => session.host === null)],
		running: running.length,
		pullRequests: uniquePullRequests(sessions.flatMap(session => session.pullRequests)),
		issues: issues.size,
	};
}
