import type { RosterHost, View } from "../../src/shared";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { agentTree, hashForView } from "../view-model";
import { StatusDot, statusLabel } from "./status-dot";

/** Pixels of extra indent per nesting level below the first subagent level. */
const NEST_INDENT = 12;

export function age(startedAt: number): string {
	const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return `${Math.floor(minutes / 1440)}d`;
}

export const hostLabel = (host: RosterHost): string =>
	host.sessionName ?? host.cwdDisplay.split("/").filter(Boolean).pop() ?? host.cwdDisplay;

interface RosterProps {
	hosts: RosterHost[];
	view: View | null;
	ompVersion: string | null;
	connected: boolean;
	onSelect: (view: View) => void;
}

export function Roster({ hosts, view, ompVersion, connected, onSelect }: RosterProps) {
	return (
		<>
			<SidebarHeader className="flex-row items-baseline justify-between px-4 pt-4">
				<h1 className="text-sm font-semibold">omp sessions</h1>
				<span className="text-xs text-muted-foreground">{ompVersion ? `omp v${ompVersion}` : ""}</span>
			</SidebarHeader>
			{!connected && (
				<p className="mx-3 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
					Lost the dashboard server. Retrying…
				</p>
			)}
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>{hosts.length === 0 ? "No sessions" : `${hosts.length} running`}</SidebarGroupLabel>
					<SidebarMenu aria-label="Running omp sessions">
						{hosts.map(host => (
							<SidebarMenuItem key={host.instanceId}>
								<SidebarMenuButton
									size="lg"
									isActive={view?.instanceId === host.instanceId && view.agentId === null}
									onClick={() => onSelect({ instanceId: host.instanceId, agentId: null })}
									title={`${host.cwd}\npid ${host.pid} · ${host.participants} participants${host.relayConnected ? "" : " · relay offline"}`}
								>
									<StatusDot status={host.status} />
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="flex items-baseline gap-2">
											<span className="truncate font-medium text-foreground">{hostLabel(host)}</span>
											<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{age(host.startedAt)}</span>
										</span>
										<span className="truncate text-xs text-muted-foreground">
											{[host.cwdDisplay, host.model ?? "no model", statusLabel(host.status), !host.relayConnected && "relay offline"]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
								</SidebarMenuButton>
								{host.agents.length > 0 && (
									<SidebarMenuSub aria-label={`Subagents of ${hostLabel(host)}`}>
										{agentTree(host.agents).map(({ agent, depth }) => {
											const agentView = { instanceId: host.instanceId, agentId: agent.id };
											return (
												<SidebarMenuSubItem key={agent.id}>
													<SidebarMenuSubButton
														href={hashForView(agentView)}
														isActive={view?.instanceId === host.instanceId && view.agentId === agent.id}
														className="h-auto min-h-7 py-1"
														style={{ marginInlineStart: depth * NEST_INDENT }}
														title={agent.activity ?? undefined}
													>
														<StatusDot status={agent.status} />
														<span className="flex min-w-0 flex-1 flex-col">
															<span className="flex items-baseline gap-1.5">
																<span className="truncate text-foreground">{agent.id}</span>
																<span className="shrink-0 text-xs text-muted-foreground">
																	{agent.kind} · {statusLabel(agent.status)}
																</span>
															</span>
															{agent.activity && (
																<span className="truncate text-xs text-muted-foreground">{agent.activity}</span>
															)}
														</span>
													</SidebarMenuSubButton>
												</SidebarMenuSubItem>
											);
										})}
									</SidebarMenuSub>
								)}
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
		</>
	);
}
