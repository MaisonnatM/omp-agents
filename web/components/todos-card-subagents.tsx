/** The Todos card's Subagents section: the view's subagents as a tree, each a link to its own view with its status and what it is doing. */
import { Tooltip } from "@/components/ui/tooltip";
import { SPLIT_CLICK, subagentModeOf } from "../labels";
import { hashForView } from "../routing";
import { useStoredState } from "../stored-state";
import type { SubagentNode } from "../todos-card-subagents-model";
import { countLabel } from "../todos-card-model";
import { StatusDot, statusLabel } from "./status-dot";
import { CancelAgentButton, type SubagentLinksValue } from "./subagent-links";
import { ChangesSection } from "./todos-card-changes";

/** Whether the section is folded shut, kept for every view; it starts open. */
const CLOSED_KEY = "omp-agents.todos-card-subagents-closed";

/** Each level of nesting indents a row by this many pixels. */
const INDENT_PX = 12;

/** `nodes`, the rows of `subagentTree` for the view, which the card shows this section for only while it has any. */
export function SubagentsSection({ links, nodes }: { links: SubagentLinksValue; nodes: readonly SubagentNode[] }) {
	const [closed, setClosed] = useStoredState(CLOSED_KEY, raw => raw === "true");
	const running = nodes.filter(node => node.agent.status === "running").length;
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
			<ul aria-label="Subagents" className="max-h-[min(30vh,12.5rem)] overflow-y-auto px-1 py-1">
				{nodes.map(({ agent, depth }) => {
					const view = { kind: "live", instanceId: links.instanceId, agentId: agent.id } as const;
					return (
						<li key={agent.id} className="flex min-w-0 items-center gap-0.5" style={{ paddingLeft: depth * INDENT_PX }}>
							<Tooltip content={`${[agent.id, agent.kind, statusLabel(agent.status), agent.activity].filter(Boolean).join(" · ")}. ${SPLIT_CLICK} to open in this pane`} side="left">
								<a
									href={hashForView(view)}
									className="grid min-w-0 flex-1 grid-cols-[0.375rem_minmax(0,1fr)] items-center gap-x-2 rounded-md px-2 py-1 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
									onClick={event => {
										// Shift- and middle-clicks keep the link's own new-window behavior.
										if (event.button !== 0 || event.shiftKey || event.altKey) return;
										event.preventDefault();
										links.onOpen(view, subagentModeOf(event));
									}}
								>
									{/* A running subagent draws no dot, so the column keeps names aligned with the rows that do. */}
									<span className="flex">
										<StatusDot status={agent.status} />
									</span>
									<span className="flex min-w-0 items-center gap-2">
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
				})}
			</ul>
		</ChangesSection>
	);
}
