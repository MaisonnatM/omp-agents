/** The Board thread's **Actions** card: what the sessions started on a Board task did outside their conversation, read from their session facts. */
import { IconBranch, IconGithub, IconLinear, IconSquareArrowTopRight } from "central-icons";
import { type ComponentType, type ReactNode, useState } from "react";
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

function ServiceTile({ kind, size = "md" }: { kind: Kind; size?: "sm" | "md" | "lg" }) {
	const { Icon, tile } = SERVICES[kind];
	const box = { sm: "size-5 rounded-[5px] [&>svg]:size-3", md: "size-7 rounded-md [&>svg]:size-4", lg: "size-9 rounded-lg [&>svg]:size-5" }[size];
	return (
		<span aria-hidden className={cn("flex shrink-0 items-center justify-center shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]", tile, box)}>
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

const Title = ({ item }: { item: Described }) => <span className={cn("min-w-0 truncate font-medium text-foreground", item.mono && "font-mono text-xs")}>{item.title}</span>;

/** Brand rows: one row per action, the company tile, the verb above the name, an arrow when it opens. */
function BrandRows({ items }: { items: Described[] }) {
	return (
		<ul className="flex flex-col p-1">
			{items.map(item => (
				<li key={item.key} className="flex flex-col">
					<Target item={item} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2">
						<ServiceTile kind={item.kind} />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="text-xs text-muted-foreground">
								{SERVICES[item.kind].name} · {item.verb}
							</span>
							<Title item={item} />
						</span>
						{(item.href || item.onClick) && <IconSquareArrowTopRight className="size-3.5 shrink-0 text-muted-foreground" />}
					</Target>
				</li>
			))}
		</ul>
	);
}

/** Logo chips: one pill per action, wrapping, the company mark leading the name. */
function LogoChips({ items }: { items: Described[] }) {
	return (
		<ul className="flex flex-wrap gap-1.5 p-2.5 pt-1">
			{items.map(item => (
				<li key={item.key} className="flex min-w-0">
					<Target item={item} className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-2.5 pl-0.5 text-[13px]">
						<ServiceTile kind={item.kind} size="sm" />
						<span className="sr-only">{item.verb}</span>
						<Title item={item} />
					</Target>
				</li>
			))}
		</ul>
	);
}

/** Timeline: the actions in order on a vertical rail, each node the company mark. */
function Timeline({ items }: { items: Described[] }) {
	return (
		<ol className="flex flex-col px-3 pt-1 pb-2">
			{items.map((item, index) => (
				<li key={item.key} className="relative flex gap-3">
					{index < items.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border" />}
					<ServiceTile kind={item.kind} />
					<Target item={item} className="mb-2 flex min-w-0 flex-1 items-baseline gap-1.5 rounded-md px-1.5 py-1 text-[13px]">
						<span className="shrink-0 text-muted-foreground">{item.verb}</span>
						<Title item={item} />
					</Target>
				</li>
			))}
		</ol>
	);
}

/** Service tiles: one tile per company, its mark and count on top, its actions listed under. */
function ServiceGrid({ items }: { items: Described[] }) {
	const kinds = (Object.keys(SERVICES) as Kind[]).filter(kind => items.some(item => item.kind === kind));
	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2 p-2 pt-1">
			{kinds.map(kind => {
				const own = items.filter(item => item.kind === kind);
				return (
					<div key={kind} className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted/40 p-2.5">
						<div className="flex items-center gap-2">
							<ServiceTile kind={kind} size="lg" />
							<span className="flex flex-col">
								<span className="text-[13px] font-medium">{SERVICES[kind].name}</span>
								<span className="text-xs text-muted-foreground">
									{own.length} {own.length === 1 ? "action" : "actions"}
								</span>
							</span>
						</div>
						<ul className="flex flex-col">
							{own.map(item => (
								<li key={item.key} className="flex flex-col">
									<Target item={item} className="-mx-1 flex min-w-0 flex-col rounded px-1 py-0.5 text-[13px]">
										<span className="text-xs text-muted-foreground">{item.verb}</span>
										<Title item={item} />
									</Target>
								</li>
							))}
						</ul>
					</div>
				);
			})}
		</div>
	);
}

/** Summary strip: the company marks stacked with a count per service, opening to the brand rows. */
function SummaryStrip({ items }: { items: Described[] }) {
	const [open, setOpen] = useState(false);
	const kinds = (Object.keys(SERVICES) as Kind[]).filter(kind => items.some(item => item.kind === kind));
	return (
		<div className="flex flex-col">
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-muted">
				<span className="flex -space-x-1.5">
					{kinds.map(kind => (
						<span key={kind} className="rounded-md ring-2 ring-background">
							<ServiceTile kind={kind} />
						</span>
					))}
				</span>
				<span className="min-w-0 flex-1 truncate text-[13px]">
					{kinds
						.map(kind => {
							const count = items.filter(item => item.kind === kind).length;
							return `${count} ${{ linear: "issue", branch: "branch", "pull-request": "PR" }[kind]}${count === 1 ? "" : kind === "branch" ? "es" : "s"}`;
						})
						.join(" · ")}
				</span>
				<span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
			</button>
			{open && (
				<div className="border-t border-border">
					<BrandRows items={items} />
				</div>
			)}
		</div>
	);
}

const VARIANTS = { "Brand rows": BrandRows, "Logo chips": LogoChips, Timeline, "Service tiles": ServiceGrid, "Summary strip": SummaryStrip } as const;
type Variant = keyof typeof VARIANTS;
const VARIANT_KEY = "omp-agents.actions-variant";

/** The **Actions** card at the foot of a Board thread, above the reply box and its suggested merge; nothing while the sessions did none. */
export function ActionsCard({ actions }: { actions: BoardAction[] }) {
	const [variant, setVariant] = useState<Variant>(() => {
		const saved = localStorage.getItem(VARIANT_KEY);
		return saved && saved in VARIANTS ? (saved as Variant) : "Brand rows";
	});
	if (actions.length === 0) return null;
	const items = actions.map(describe);
	const Body = VARIANTS[variant];
	return (
		<section aria-label="Actions" className="mx-5 mt-2 max-w-conversation rounded-lg border border-border bg-background">
			<div className="flex flex-wrap items-center gap-2 px-3 pt-2 pb-1">
				<h3 className="flex-1 text-xs font-medium text-muted-foreground">Actions</h3>
				<div role="radiogroup" aria-label="Prototype" className="flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5">
					{(Object.keys(VARIANTS) as Variant[]).map(name => (
						<button
							key={name}
							type="button"
							role="radio"
							aria-checked={name === variant}
							onClick={() => {
								localStorage.setItem(VARIANT_KEY, name);
								setVariant(name);
							}}
							className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-muted-foreground", name === variant && "bg-background text-foreground shadow-sm")}
						>
							{name}
						</button>
					))}
				</div>
			</div>
			<Body items={items} />
		</section>
	);
}
