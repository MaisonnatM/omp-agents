/** The Board thread's **Actions** card: what the sessions started on a Board task did outside their conversation, read from their session facts. */
import { IconBranch, IconLinear, IconPullRequest, IconSquareArrowTopRight } from "central-icons";
import type { PullRequest } from "../../../src/shared/github";
import type { SessionFacts } from "../../../src/shared/sessions";
import { type BoardTask, startedOn } from "../../../templates/omp/agent/extensions/board/log";
import { revealDetailsTab } from "../../details-tabs";
import type { KnownSessions } from "../todo/links";
import { THREAD_TABS } from "./sidebar";

export type BoardAction = { kind: "linear"; issue: string } | { kind: "branch"; name: string } | { kind: "pull-request"; pullRequest: PullRequest; opened: boolean };

const prKey = ({ owner, repo, number }: PullRequest): string => `${owner}/${repo}#${number}`;

/** What the sessions started on `task` did, oldest session first: the Linear issues they saved, the branches they worked on, and the pull requests they opened or worked on, each once. */
export function boardActions(task: BoardTask, { hosts, past }: KnownSessions): BoardAction[] {
	const issues = new Set<string>();
	const branches = new Set<string>();
	const pullRequests = new Map<string, { pullRequest: PullRequest; opened: boolean }>();
	for (const id of new Set(startedOn(task))) {
		const facts: SessionFacts | undefined = hosts.find(each => each.sessionId === id) ?? past.find(each => each.sessionId === id);
		if (!facts) continue;
		for (const issue of facts.issues) issues.add(issue);
		const { branch } = facts;
		if (branch && branch.name !== branch.defaultBranch) branches.add(branch.name);
		const worked = [...facts.pullRequests.map(pr => ({ pullRequest: pr as PullRequest, opened: pr.link === "submitted" })), ...(branch?.pullRequest ? [{ pullRequest: branch.pullRequest, opened: false }] : [])];
		for (const each of worked) {
			const key = prKey(each.pullRequest);
			const seen = pullRequests.get(key);
			pullRequests.set(key, { pullRequest: each.pullRequest, opened: each.opened || (seen?.opened ?? false) });
		}
	}
	return [
		...[...issues].map(issue => ({ kind: "linear", issue }) as const),
		...[...branches].map(name => ({ kind: "branch", name }) as const),
		...[...pullRequests.values()].map(each => ({ kind: "pull-request", ...each }) as const),
	];
}

const ROW = "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted";

function ActionRow({ action }: { action: BoardAction }) {
	switch (action.kind) {
		case "linear":
			return (
				<button type="button" className={ROW} onClick={() => revealDetailsTab(THREAD_TABS, "linear", "thread")}>
					<IconLinear className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 truncate">
						Saved Linear issue <span className="font-medium">{action.issue}</span>
					</span>
				</button>
			);
		case "branch":
			return (
				<div className={ROW}>
					<IconBranch className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 truncate">
						Worked on branch <code className="font-mono text-xs">{action.name}</code>
					</span>
				</div>
			);
		case "pull-request": {
			const { owner, repo, number } = action.pullRequest;
			return (
				<a href={`https://github.com/${owner}/${repo}/pull/${number}`} target="_blank" rel="noreferrer" className={ROW}>
					<IconPullRequest className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">
						{action.opened ? "Opened" : "Worked on"} pull request{" "}
						<span className="font-medium">
							{owner}/{repo}#{number}
						</span>
					</span>
					<IconSquareArrowTopRight className="size-3.5 shrink-0 text-muted-foreground" />
				</a>
			);
		}
	}
}

/** The **Actions** card at the foot of a Board thread, above the reply box and its suggested merge; nothing while the sessions did none. */
export function ActionsCard({ actions }: { actions: BoardAction[] }) {
	if (actions.length === 0) return null;
	return (
		<section aria-label="Actions" className="mx-5 mt-2 max-w-conversation rounded-lg border border-border bg-background p-1">
			<h3 className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">Actions</h3>
			<ul className="flex flex-col">
				{actions.map(action => (
					<li key={action.kind === "pull-request" ? prKey(action.pullRequest) : `${action.kind}:${action.kind === "linear" ? action.issue : action.name}`} className="flex flex-col">
						<ActionRow action={action} />
					</li>
				))}
			</ul>
		</section>
	);
}
