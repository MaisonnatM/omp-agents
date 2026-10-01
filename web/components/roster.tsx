import { Plus } from "lucide-react";
import { useState } from "react";
import type { PastSession, RosterHost, View } from "../../src/shared";
import { Button } from "@/components/ui/button";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { Launch } from "../use-dashboard";
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

const lastSegment = (cwdDisplay: string): string | undefined => cwdDisplay.split("/").filter(Boolean).pop();

export const hostLabel = (host: RosterHost): string => host.sessionName ?? lastSegment(host.cwdDisplay) ?? host.cwdDisplay;

export const pastLabel = (session: PastSession): string => session.title ?? lastSegment(session.cwdDisplay) ?? "Untitled session";

interface NewSessionFormProps {
	launch: Exclude<Launch, { phase: "closed" }>;
	defaultCwd: string;
	connected: boolean;
	onCreate: (cwd: string) => void;
	onCancel: () => void;
}

function NewSessionForm({ launch, defaultCwd, connected, onCreate, onCancel }: NewSessionFormProps) {
	const [cwd, setCwd] = useState(defaultCwd);
	const starting = launch.phase === "starting";
	return (
		<form
			className="mx-2 mb-2 flex flex-col gap-2 rounded-md border border-border p-2"
			aria-label="New session"
			onSubmit={event => {
				event.preventDefault();
				if (cwd.trim()) onCreate(cwd);
			}}
		>
			<label className="flex flex-col gap-1 text-xs text-muted-foreground">
				Working directory
				<SidebarInput
					value={cwd}
					onChange={event => setCwd(event.target.value)}
					disabled={starting}
					autoFocus
					spellCheck={false}
					className="font-mono text-xs"
				/>
			</label>
			{launch.phase === "editing" && launch.error && (
				<p className="text-xs text-red-600 dark:text-red-400" role="alert">
					{launch.error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="compact" onClick={onCancel} disabled={starting}>
					Cancel
				</Button>
				<Button type="submit" size="compact" disabled={starting || !connected || !cwd.trim()}>
					{starting ? "Starting…" : "Start"}
				</Button>
			</div>
		</form>
	);
}

interface RosterProps {
	hosts: RosterHost[];
	past: PastSession[];
	view: View | null;
	ompVersion: string | null;
	connected: boolean;
	launch: Launch;
	defaultCwd: string;
	onSelect: (view: View) => void;
	onLaunchOpen: (open: boolean) => void;
	onCreate: (cwd: string) => void;
}

export function Roster({
	hosts,
	past,
	view,
	ompVersion,
	connected,
	launch,
	defaultCwd,
	onSelect,
	onLaunchOpen,
	onCreate,
}: RosterProps) {
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
					<SidebarGroupAction
						title="New session"
						aria-label="New session"
						aria-expanded={launch.phase !== "closed"}
						onClick={() => onLaunchOpen(launch.phase === "closed")}
					>
						<Plus />
					</SidebarGroupAction>
					{launch.phase !== "closed" && (
						<NewSessionForm
							launch={launch}
							defaultCwd={defaultCwd}
							connected={connected}
							onCreate={onCreate}
							onCancel={() => onLaunchOpen(false)}
						/>
					)}
					<SidebarMenu aria-label="Running omp sessions">
						{hosts.map(host => (
							<SidebarMenuItem key={host.instanceId}>
								<SidebarMenuButton
									size="lg"
									isActive={view?.kind === "live" && view.instanceId === host.instanceId && view.agentId === null}
									onClick={() => onSelect({ kind: "live", instanceId: host.instanceId, agentId: null })}
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
											const agentView: View = { kind: "live", instanceId: host.instanceId, agentId: agent.id };
											return (
												<SidebarMenuSubItem key={agent.id}>
													<SidebarMenuSubButton
														href={hashForView(agentView)}
														isActive={view?.kind === "live" && view.instanceId === host.instanceId && view.agentId === agent.id}
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
				<SidebarGroup>
					<SidebarGroupLabel>{past.length === 0 ? "No past sessions" : `${past.length} past`}</SidebarGroupLabel>
					<SidebarMenu aria-label="Past omp sessions">
						{past.map(session => (
							<SidebarMenuItem key={session.sessionId}>
								<SidebarMenuButton
									size="lg"
									isActive={view?.kind === "past" && view.sessionId === session.sessionId}
									onClick={() => onSelect({ kind: "past", sessionId: session.sessionId })}
									title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
								>
									<span className="size-4 shrink-0" aria-hidden />
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="flex items-baseline gap-2">
											<span className="truncate font-medium text-foreground">{pastLabel(session)}</span>
											<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
												{age(session.modifiedAt)}
											</span>
										</span>
										<span className="truncate text-xs text-muted-foreground">{session.cwdDisplay || "unknown directory"}</span>
									</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
		</>
	);
}
