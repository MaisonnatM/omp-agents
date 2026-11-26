/** A Board thread's actions: what each session started on a Board task did outside its conversation, read from its session facts and drawn under that session's last reply. */
import { IconGit, IconGithub, IconLinear, IconSquareArrowTopRight } from "central-icons";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PullRequest } from "../../../src/shared/github";
import type { SessionFacts } from "../../../src/shared/sessions";
import { type BoardTask, startedOn } from "../../../templates/omp/agent/extensions/board/log";
import { revealDetailsTab } from "../../details-tabs";
import type { KnownSessions } from "../../labels";
import { THREAD_TABS } from "./sidebar";

export type BoardAction = { kind: "linear"; issue: string } | { kind: "branch"; name: string } | { kind: "pull-request"; pullRequest: PullRequest; opened: boolean };

const prKey = ({ owner, repo, number }: PullRequest): string => `${owner}/${repo}#${number}`;

const actionKey = (action: BoardAction): string => (action.kind === "linear" ? `linear:${action.issue}` : action.kind === "branch" ? `branch:${action.name}` : prKey(action.pullRequest));

/** What one session did: the Linear issues it saved, the branch it worked on, and the pull requests it opened or worked on. */
function sessionActions(facts: SessionFacts): BoardAction[] {
	const { branch } = facts;
	const pullRequests = new Map<string, { pullRequest: PullRequest; opened: boolean }>();
	for (const each of [...facts.pullRequests.map(pr => ({ pullRequest: pr as PullRequest, opened: pr.link === "submitted" })), ...(branch?.pullRequest ? [{ pullRequest: branch.pullRequest, opened: false }] : [])]) {
		const key = prKey(each.pullRequest);
		pullRequests.set(key, { pullRequest: each.pullRequest, opened: each.opened || (pullRequests.get(key)?.opened ?? false) });
	}
	return [
		...facts.issues.map(issue => ({ kind: "linear", issue }) as const),
		...(branch && branch.name !== branch.defaultBranch ? [{ kind: "branch", name: branch.name } as const] : []),
		...[...pullRequests.values()].map(each => ({ kind: "pull-request", ...each }) as const),
	];
}

/** Each session started on `task` to the actions it did that no earlier session did, oldest session first; a session with none is left out. A pull request a later session opened counts as opened where it first shows. */
export function boardActions(task: BoardTask, { hosts, past }: KnownSessions): Map<string, BoardAction[]> {
	const first = new Map<string, BoardAction>();
	const bySession = new Map<string, BoardAction[]>();
	for (const id of new Set(startedOn(task))) {
		const facts: SessionFacts | undefined = hosts.find(each => each.sessionId === id) ?? past.find(each => each.sessionId === id);
		if (!facts) continue;
		for (const action of sessionActions(facts)) {
			const key = actionKey(action);
			const seen = first.get(key);
			if (seen) {
				if (seen.kind === "pull-request" && action.kind === "pull-request" && action.opened) seen.opened = true;
				continue;
			}
			first.set(key, action);
			bySession.set(id, [...(bySession.get(id) ?? []), action]);
		}
	}
	return bySession;
}

/** The service behind each kind of action, drawn as its company mark on the service's own color. */
const SERVICES = {
	linear: { Icon: IconLinear, tile: "bg-[#5E6AD2] text-white" },
	branch: { Icon: IconGit, tile: "bg-[#F05032] text-white" },
	"pull-request": { Icon: IconGithub, tile: "bg-[#1f2328] text-white dark:bg-white dark:text-[#1f2328]" },
} satisfies Record<BoardAction["kind"], { Icon: ComponentType<{ className?: string }>; tile: string }>;

type Kind = BoardAction["kind"];

function ServiceTile({ kind }: { kind: Kind }) {
	const { Icon, tile } = SERVICES[kind];
	return (
		<span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-[5px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] [&>svg]:size-3", tile)}>
			<Icon />
		</span>
	);
}

type Described = { kind: Kind; key: string; verb: string; title: string; mono: boolean; href?: string; onClick?: () => void };

function describe(action: BoardAction): Described {
	switch (action.kind) {
		case "linear":
			return { kind: "linear", key: actionKey(action), verb: "Saved issue", title: action.issue, mono: false, onClick: () => revealDetailsTab(THREAD_TABS, "linear", "thread") };
		case "branch":
			return { kind: "branch", key: actionKey(action), verb: "Worked on branch", title: action.name, mono: true };
		case "pull-request": {
			const { owner, repo, number } = action.pullRequest;
			return {
				kind: "pull-request",
				key: actionKey(action),
				verb: action.opened ? "Opened pull request" : "Worked on pull request",
				title: `${owner}/${repo}#${number}`,
				mono: false,
				href: `https://github.com/${owner}/${repo}/pull/${number}`,
			};
		}
	}
}

/** Wraps `children` in the action's link or button, else a plain box. */
function Target({ item, className, label, children }: { item: Described; className: string; label: string; children: ReactNode }) {
	if (item.href)
		return (
			<a href={item.href} target="_blank" rel="noreferrer" title={label} aria-label={label} className={cn(className, "hover:bg-muted")}>
				{children}
			</a>
		);
	if (item.onClick)
		return (
			<button type="button" onClick={item.onClick} title={label} aria-label={label} className={cn(className, "text-left hover:bg-muted")}>
				{children}
			</button>
		);
	return (
		<div title={label} className={className}>
			{children}
		</div>
	);
}

/** One session's actions, under its last reply and aligned with the reply's text: a row per action with its company mark and name, the verb as its hover text, and an arrow when it opens. */
export function SessionActions({ actions }: { actions: BoardAction[] }) {
	return (
		<ul aria-label="What the session did" className="flex flex-col items-start pt-0.5 pr-6 pb-1 pl-15">
			{actions.map(describe).map(item => (
				<li key={item.key} className="max-w-full">
					<Target item={item} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-[13px]" label={`${item.verb} ${item.title}`}>
						<ServiceTile kind={item.kind} />
						<span className={cn("min-w-0 truncate font-medium text-foreground", item.mono && "font-mono text-xs")}>{item.title}</span>
						{(item.href || item.onClick) && <IconSquareArrowTopRight className="size-3.5 shrink-0 text-muted-foreground" />}
					</Target>
				</li>
			))}
		</ul>
	);
}
