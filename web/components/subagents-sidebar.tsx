import { Columns2, ExternalLink } from "lucide-react";
import type { RosterHost, View } from "../../src/shared";
import { ContextMenuLinkItem } from "@/components/ui/context-menu";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { agentTree, hashForView, MAX_PANES, type OpenMode, sameView } from "../view-model";
import { hostLabel, modeOf, RowMenu, SPLIT_CLICK } from "./roster";
import { StatusDot, statusLabel } from "./status-dot";

/** Pixels of extra indent per nesting level below the first subagent level. */
const NEST_INDENT = 12;

interface SubagentsSidebarProps {
	/** The live session that owns the focused pane. */
	host: RosterHost;
	/** Views on screen, highlighted in the list. */
	open: View[];
	onOpen: (view: View, mode: OpenMode) => void;
}

/** The right sidebar's content: the subagents of the focused live session, nested by parent. */
export function SubagentsSidebar({ host, open, onOpen }: SubagentsSidebarProps) {
	const label = hostLabel(host);
	const count = host.agents.length;
	return (
		<>
			<SidebarHeader className="flex-row items-center gap-2 px-3 pt-4">
				<h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={host.cwd}>
					{label}
				</h2>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>{count === 0 ? "No subagents" : `${count} subagent${count === 1 ? "" : "s"}`}</SidebarGroupLabel>
					{count > 0 && (
						<SidebarMenu aria-label={`Subagents of ${label}`}>
							{agentTree(host.agents).map(({ agent, depth }) => {
								const view: View = { kind: "live", instanceId: host.instanceId, agentId: agent.id };
								const isOpen = open.some(pane => sameView(pane, view));
								return (
									<RowMenu
										key={agent.id}
										view={view}
										isOpen={isOpen}
										onOpen={onOpen}
										items={
											// The row is a link, so the menu keeps what the browser's own would offer for it.
											<ContextMenuLinkItem href={hashForView(view)} target="_blank">
												<ExternalLink />
												Open in new tab
											</ContextMenuLinkItem>
										}
									>
										<SidebarMenuItem style={{ marginInlineStart: depth * NEST_INDENT }}>
											<SidebarMenuButton asChild isActive={isOpen} className="h-auto min-h-8 py-1">
												<a
													href={hashForView(view)}
													title={agent.activity ?? undefined}
													onClick={event => {
														// Shift- and middle-clicks keep the link's own new-window behavior.
														if (event.button !== 0 || event.shiftKey || event.altKey) return;
														event.preventDefault();
														onOpen(view, modeOf(event));
													}}
												>
													<StatusDot status={agent.status} />
													<span className="flex min-w-0 flex-1 flex-col">
														<span className="truncate text-foreground">{agent.id}</span>
														<span className="truncate text-xs text-muted-foreground">
															{[agent.kind, statusLabel(agent.status), agent.activity].filter(Boolean).join(" · ")}
														</span>
													</span>
												</a>
											</SidebarMenuButton>
											{!isOpen && (
												<SidebarMenuAction
													showOnHover
													aria-label={`Open ${agent.id} in split`}
													title={open.length < MAX_PANES ? `Open in split (${SPLIT_CLICK})` : `Open in the focused pane: ${MAX_PANES} panes is the most`}
													onClick={() => onOpen(view, "split")}
												>
													<Columns2 />
												</SidebarMenuAction>
											)}
										</SidebarMenuItem>
									</RowMenu>
								);
							})}
						</SidebarMenu>
					)}
				</SidebarGroup>
			</SidebarContent>
		</>
	);
}
