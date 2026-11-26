/** The Board thread's **Actions** card: what the sessions started on a Board task did outside their conversation, read from their session facts. */
import { IconBranch, IconGithub, IconLinear, IconSquareArrowTopRight } from "central-icons";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
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

/** The service behind each kind of action, drawn as its company mark on the service's own color. */
const SERVICES = {
	linear: { name: "Linear", Icon: IconLinear, tile: "bg-[#5E6AD2] text-white" },
	branch: { name: "Git", Icon: IconBranch, tile: "bg-[#F05032] text-white" },
	"pull-request": { name: "GitHub", Icon: IconGithub, tile: "bg-[#1f2328] text-white dark:bg-white dark:text-[#1f2328]" },
} satisfies Record<BoardAction["kind"], { name: string; Icon: ComponentType<{ className?: string }>; tile: string }>;

type Kind = BoardAction["kind"];

function ServiceTile({ kind }: { kind: Kind }) {
	const { Icon, tile } = SERVICES[kind];
	return (
		<span aria-hidden className={cn("flex size-7 shrink-0 items-center justify-center rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] [&>svg]:size-4", tile)}>
			<Icon />
		</span>
	);
}

type Described = { kind: Kind; key: string; verb: string; title: string; mono: boolean; href?: string; onClick?: () => void };

function describe(action: BoardAction): Described {
	switch (action.kind) {
		case "linear":
			return { kind: "linear", key: `linear:${action.issue}`, verb: "Saved issue", title: action.issue, mono: false, onClick: () => revealDetailsTab(THREAD_TABS, "linear", "thread") };
		case "branch":
			return { kind: "branch", key: `branch:${action.name}`, verb: "Worked on branch", title: action.name, mono: true };
		case "pull-request": {
			const { owner, repo, number } = action.pullRequest;
			return {
				kind: "pull-request",
				key: prKey(action.pullRequest),
				verb: action.opened ? "Opened pull request" : "Worked on pull request",
				title: `${owner}/${repo}#${number}`,
				mono: false,
				href: `https://github.com/${owner}/${repo}/pull/${number}`,
			};
		}
	}
}

/** Wraps `children` in the action's link or button, else a plain box. */
function Target({ item, className, children }: { item: Described; className: string; children: ReactNode }) {
	if (item.href)
		return (
			<a href={item.href} target="_blank" rel="noreferrer" className={cn(className, "hover:bg-muted")}>
				{children}
			</a>
		);
	if (item.onClick)
		return (
			<button type="button" onClick={item.onClick} className={cn(className, "text-left hover:bg-muted")}>
				{children}
			</button>
		);
	return <div className={className}>{children}</div>;
}

/** The **Actions** card at the foot of a Board thread, above the reply box and its suggested merge: one row per action with its company mark, the verb above the name, an arrow when it opens; nothing while the sessions did none. */
export function ActionsCard({ actions }: { actions: BoardAction[] }) {
	if (actions.length === 0) return null;
	return (
		<section aria-label="Actions" className="mx-5 mt-2 max-w-conversation rounded-lg border border-border bg-background">
			<h3 className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">Actions</h3>
			<ul className="flex flex-col p-1">
				{actions.map(describe).map(item => (
					<li key={item.key} className="flex flex-col">
						<Target item={item} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2">
							<ServiceTile kind={item.kind} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="text-xs text-muted-foreground">
									{SERVICES[item.kind].name} · {item.verb}
								</span>
								<span className={cn("min-w-0 truncate font-medium text-foreground", item.mono && "font-mono text-xs")}>{item.title}</span>
							</span>
							{(item.href || item.onClick) && <IconSquareArrowTopRight className="size-3.5 shrink-0 text-muted-foreground" />}
						</Target>
					</li>
				))}
			</ul>
		</section>
	);
}
