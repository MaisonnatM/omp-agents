/**
 * The Todos card's Subagents section: the view's subagents as a tree, each a link to its own view with its status and what it is doing.
 * The runners of an arena the session recorded sit side by side above the tree, with the judge under them and the base marked.
 */
import { Gavel, Swords, Trophy } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentRow, ArenaRecord } from "../../src/shared/sessions";
import { modeOf, SPLIT_CLICK } from "../labels";
import { hashForView } from "../routing";
import { useStoredState } from "../stored-state";
import { type ArenaGroup, type ArenaSeat, arenaGroups, type SubagentNode } from "../todos-card-subagents-model";
import { countLabel } from "../todos-card-model";
import { StatusDot, statusLabel } from "./status-dot";
import { CancelAgentButton, type SubagentLinksValue } from "./subagent-links";
import { ChangesSection } from "./todos-card-changes";

/** Whether the section is folded shut, kept for every view; it starts open. */
const CLOSED_KEY = "omp-agents.todos-card-subagents-closed";

/** Each level of nesting indents a row by this many pixels. */
const INDENT_PX = 12;

/** `nodes`, the rows of `subagentTree` for the view, which the card shows this section for only while it has any; `arenas`, the session's. */
export function SubagentsSection({ links, nodes, arenas }: { links: SubagentLinksValue; nodes: readonly SubagentNode[]; arenas: readonly ArenaRecord[] }) {
	const [closed, setClosed] = useStoredState(CLOSED_KEY, raw => raw === "true");
	const running = nodes.filter(node => node.agent.status === "running").length;
	const { groups, rest } = arenaGroups(nodes, arenas);
	return (
		<ChangesSection
			title={
				<span className="truncate">
					{countLabel(nodes.length, "Subagent", "Subagents")}
					{running > 0 && <span className="font-normal text-muted-foreground"> · {running} running</span>}
				</span>
			}
			open={!closed}
			onToggle={() => setClosed(shut => !shut)}
			fold="transcript.subagents"
		>
			{groups.map(group => (
				<ArenaLanes key={group.seats[0].agent.id} group={group} links={links} />
			))}
			{rest.length > 0 && (
				<ul aria-label="Subagents" className="max-h-[min(30vh,12.5rem)] overflow-y-auto px-1 py-1">
					{rest.map(({ agent, depth }) => (
						<SubagentRow key={agent.id} agent={agent} depth={depth} links={links} />
					))}
				</ul>
			)}
		</ChangesSection>
	);
}

/** Opens `agentId`'s view on a plain click; shift- and middle-clicks keep the link's own new-window behavior. */
function openHandler(links: SubagentLinksValue, agentId: string) {
	const view = { kind: "live", instanceId: links.instanceId, agentId } as const;
	return {
		view,
		href: hashForView(view),
		onClick: (event: MouseEvent) => {
			if (event.button !== 0 || event.shiftKey || event.altKey) return;
			event.preventDefault();
			links.onOpen(view, modeOf(event));
		},
	};
}

const tooltipOf = (agent: AgentRow) => `${[agent.id, agent.kind, statusLabel(agent.status), agent.activity].filter(Boolean).join(" · ")}. ${SPLIT_CLICK} to open in a split`;

/** One subagent as a row of the tree, with an optional `lead` icon before its name. */
function SubagentRow({ agent, depth, links, lead }: { agent: AgentRow; depth: number; links: SubagentLinksValue; lead?: ReactNode }) {
	const { view, href, onClick } = openHandler(links, agent.id);
	return (
		<li className="flex min-w-0 items-center gap-0.5" style={{ paddingLeft: depth * INDENT_PX }}>
			<Tooltip content={tooltipOf(agent)} side="left">
				<a
					href={href}
					className="grid min-w-0 flex-1 grid-cols-[0.375rem_minmax(0,1fr)] items-center gap-x-2 rounded-md px-2 py-1 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onClick}
				>
					{/* A running subagent draws no dot, so the column keeps names aligned with the rows that do. */}
					<span className="flex">
						<StatusDot status={agent.status} />
					</span>
					<span className="flex min-w-0 items-center gap-2">
						{lead}
						<span className="truncate text-foreground">{agent.id}</span>
						{depth > 0 && <span className="sr-only">, started by {agent.parentId}</span>}
						<span className="shrink-0 text-xs text-muted-foreground">{agent.kind}</span>
					</span>
					{agent.activity && <span className="col-start-2 truncate text-xs text-muted-foreground">{agent.activity}</span>}
				</a>
			</Tooltip>
			{links.onCancel && <CancelAgentButton view={view} onCancel={links.onCancel} running={agent.status === "running"} />}
		</li>
	);
}

/** An arena: its task, its runners as cards side by side, and its judge under them. */
function ArenaLanes({ group, links }: { group: ArenaGroup; links: SubagentLinksValue }) {
	return (
		<section aria-label={`Arena: ${group.task}`} className="mx-1 mt-1 rounded-lg border border-border/70 p-1">
			<div className="flex min-w-0 items-center gap-2 px-2 pt-1 pb-1 text-[13px]">
				<Swords aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="shrink-0 font-medium text-foreground">Arena</span>
				<span className="min-w-0 truncate text-muted-foreground">{group.task}</span>
				{group.base && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{group.base} is the base</span>}
			</div>
			<ul aria-label="Arena runners" className="grid grid-cols-[repeat(auto-fit,minmax(7.75rem,1fr))] gap-1.5 px-1">
				{group.seats.map(seat => (
					<RunnerCard key={seat.agent.id} seat={seat} won={group.base === seat.seat} picked={group.base !== null} links={links} />
				))}
			</ul>
			{group.judge && (
				<ul aria-label="Arena judge" className="mt-1">
					<SubagentRow agent={group.judge} depth={0} links={links} lead={<Gavel aria-label="Judge" className="size-3.5 shrink-0 text-muted-foreground" />} />
				</ul>
			)}
		</section>
	);
}

function RunnerCard({ seat, won, picked, links }: { seat: ArenaSeat; won: boolean; picked: boolean; links: SubagentLinksValue }) {
	const { agent } = seat;
	const { view, href, onClick } = openHandler(links, agent.id);
	return (
		<li className="group/runner relative min-w-0">
			<Tooltip content={tooltipOf(agent)} side="top">
				<a
					href={href}
					onClick={onClick}
					aria-label={`Runner ${seat.seat}: ${agent.id}, ${statusLabel(agent.status)}`}
					className={cn(
						"flex h-full min-w-0 flex-col gap-1 rounded-lg border border-border p-2.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
						won && "border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30 hover:bg-emerald-500/10",
					)}
				>
					<div className="flex min-w-0 items-center gap-1.5 text-[13px]">
						<span className={cn("inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 text-[11px] font-semibold tabular-nums", won ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>{seat.seat}</span>
						<span className="truncate text-foreground">{agent.id}</span>
						<span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
							<StatusDot status={agent.status} />
							{statusLabel(agent.status).toLowerCase()}
						</span>
					</div>
					<div className="truncate text-xs text-muted-foreground">{agent.kind}</div>
					{agent.activity && <div className="line-clamp-2 text-xs text-muted-foreground">{agent.activity}</div>}
					{picked && <Verdict seat={seat} />}
				</a>
			</Tooltip>
			{links.onCancel && agent.status === "running" && (
				<span className="absolute top-1 right-1 hidden group-focus-within/runner:block group-hover/runner:block">
					<CancelAgentButton view={view} onCancel={links.onCancel} running />
				</span>
			)}
		</li>
	);
}

function Verdict({ seat }: { seat: ArenaSeat }) {
	const { verdict } = seat;
	if (verdict === null) return null;
	return (
		<div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-0.5">
			{verdict.kind === "base" ? (
				<Badge size="compact" color="emerald">
					<Trophy aria-hidden className="mr-1 inline size-3 align-[-1px]" />
					Base
				</Badge>
			) : verdict.kind === "graft" ? (
				<>
					<Badge size="compact" color="violet">
						Graft
					</Badge>
					<span className="line-clamp-2 min-w-0 text-xs text-muted-foreground">{verdict.what}</span>
				</>
			) : (
				<Badge size="compact" color="gray">
					Not used
				</Badge>
			)}
		</div>
	);
}
