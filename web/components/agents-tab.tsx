import type { AgentRow, AgentStatus, HostStatus, LiveView, RosterHost } from "../../src/shared";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { hostLabel, modeOf, SPLIT_CLICK } from "../labels";
import { useDashboardContext } from "./dashboard-context";
import { StatusDot, statusLabel } from "./status-dot";

/** Each nesting level's indent, in px. */
const INDENT = 12;

/** The session's subagents depth first, each under the agent that spawned it; one whose parent is not registered sits at the top. */
function agentTree(agents: AgentRow[]): { agent: AgentRow; depth: number }[] {
	const ids = new Set(agents.map(agent => agent.id));
	const children = Map.groupBy(agents, agent => (agent.parentId !== null && ids.has(agent.parentId) ? agent.parentId : null));
	const walk = (parentId: string | null, depth: number): { agent: AgentRow; depth: number }[] =>
		(children.get(parentId) ?? []).flatMap(agent => [{ agent, depth }, ...walk(agent.id, depth + 1)]);
	return walk(null, 0);
}

interface AgentButtonProps {
	view: LiveView;
	current: boolean;
	status: AgentStatus | HostStatus;
	label: string;
	detail: string;
	depth: number;
}

function AgentButton({ view, current, status, label, detail, depth }: AgentButtonProps) {
	const { open } = useDashboardContext();
	return (
		<SidebarMenuItem>
			<Tooltip content={`${label} · ${detail} · ${statusLabel(status)}. ${SPLIT_CLICK} to open it in a split`} side="left">
				<SidebarMenuButton
					isActive={current}
					onClick={event => open(view, modeOf(event))}
					className="h-auto min-h-8 items-start py-1.5"
					style={{ paddingInlineStart: 8 + depth * INDENT }}
				>
					<StatusDot status={status} />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate text-foreground">{label}</span>
						<span className="truncate text-xs text-muted-foreground">{detail}</span>
					</span>
				</SidebarMenuButton>
			</Tooltip>
		</SidebarMenuItem>
	);
}

/** The live session's main agent, then its subagents as a tree; the row of the agent the pane shows is highlighted. */
export function AgentsTab({ view, host }: { view: LiveView; host: RosterHost | null }) {
	if (!host) return <p className="px-4 py-2 text-sm text-muted-foreground">This session is no longer running.</p>;
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Agents">
				<AgentButton
					view={{ kind: "live", instanceId: host.instanceId, agentId: null }}
					current={view.agentId === null}
					status={host.status}
					label={hostLabel(host)}
					detail="Main agent"
					depth={0}
				/>
				{agentTree(host.agents).map(({ agent, depth }) => (
					<AgentButton
						key={agent.id}
						view={{ kind: "live", instanceId: host.instanceId, agentId: agent.id }}
						current={view.agentId === agent.id}
						status={agent.status}
						label={agent.id}
						detail={[agent.kind, agent.activity].filter(Boolean).join(" · ")}
						depth={depth + 1}
					/>
				))}
			</SidebarMenu>
			{host.agents.length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">No subagents yet.</p>}
		</SidebarGroup>
	);
}
