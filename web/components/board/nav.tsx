/** The left sidebar's Board mode: the inbox, schedules, channels, and members, in the Sessions list's rows. */
import { IconBell, IconCalendar1, IconHashtag, IconPlusSmall } from "central-icons";
import { useMemo, useState, type ReactNode } from "react";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import type { IconComponent } from "@/lib/icon-context";
import type { RosterHost } from "../../../src/shared/sessions";
import type { Bot } from "../../../src/shared/bots";
import { type BoardIndex, boardIndex, type BoardState, boardMembers, type Member } from "../../../src/shared/board";
import { CountPill } from "../count-pill";
import { hashForPage } from "../../routing";
import { type BoardRoute, type BoardView, resolveBoardView } from "./module";
import { useDashboardActions } from "../dashboard-context";
import { Avatar, NameDialog, relTime, useNow } from "./parts";

/** The Board's own list, which the left sidebar shows in its Board mode; `route` is the route the Board shows, and nothing renders until its state loads. */
export function BoardNav({ state, hosts, bots, route }: { state: BoardState | null; hosts: RosterHost[]; bots: Bot[] | null; route: BoardRoute }) {
	const now = useNow();
	const members = useMemo(() => (state ? boardMembers(state, hosts, bots ?? []) : []), [state, hosts, bots]);
	const index = useMemo(() => (state ? boardIndex(state, members) : null), [state, members]);
	if (!state || !index) return null;
	const view = resolveBoardView(state, index.memberById, route.view);
	return <Rail state={state} members={members} index={index} now={now} view={view} onView={next => (location.hash = hashForPage({ kind: "board", view: next, thread: null }))} />;
}

/** A channel's name as the rail shows it after `#`: lower case, words joined by hyphens. */
const channelName = (typed: string) => typed.toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-");

function Rail({ state, members, index, view, onView, now }: { state: BoardState; members: Member[]; index: BoardIndex; view: BoardView; onView: (view: BoardView) => void; now: number }) {
	const { changeModule } = useDashboardActions();
	const [naming, setNaming] = useState(false);
	function createChannel(typed: string) {
		const id = `c-${crypto.randomUUID()}`;
		void changeModule("board", { op: "channel", channel: { id, name: channelName(typed), about: "" } });
		onView({ kind: "channel", id });
	}
	const sel = (other: BoardView) => view.kind === other.kind && ("id" in view ? "id" in other && view.id === other.id : true);
	const humans = members.filter(member => member.kind === "human");
	// Named agents and Bots, then the omp sessions on the board, which carry a session id.
	const agents = members.filter(member => member.kind !== "human" && (!member.sessionId || member.botId));
	const sessions = members.filter(member => member.kind !== "human" && member.sessionId && !member.botId);
	const unreadIn = (channel: string) => state.threads.filter(thread => thread.channel === channel).reduce((sum, thread) => sum + (index.unreadByThread.get(thread.id) ?? 0), 0);
	const memberRow = (member: Member) => (
		<RailRow
			key={member.id}
			leading={<Avatar member={member} size="xs" />}
			label={member.id === state.me ? `${member.name} (you)` : member.name}
			hint={member.kind === "human" ? `${member.name} · ${member.presence === "online" ? "Online" : "Away"}` : member.harness ? `${member.name} · ${member.harness}` : member.name}
			count={index.queueByMember.get(member.id)?.length}
			selected={sel({ kind: "member", id: member.id })}
			onClick={() => onView({ kind: "member", id: member.id })}
		/>
	);
	return (
		<nav aria-label="Board" className="pb-2">
			<RailGroup>
				<RailRow icon={IconBell} label="Inbox" count={index.queueByMember.get(state.me)?.length} selected={sel({ kind: "inbox" })} onClick={() => onView({ kind: "inbox" })} />
				<RailRow
					icon={IconCalendar1}
					label="Scheduled"
					hint={state.schedules.length > 0 ? relTime(Math.min(...state.schedules.map(item => item.at)), now) : undefined}
					selected={sel({ kind: "scheduled" })}
					onClick={() => onView({ kind: "scheduled" })}
				/>
			</RailGroup>
			<RailGroup
				label="Channels"
				action={
					<Tooltip content="New channel" side="bottom">
						<SidebarGroupAction aria-label="New channel" onClick={() => setNaming(true)}>
							<IconPlusSmall />
						</SidebarGroupAction>
					</Tooltip>
				}
			>
				{state.channels.map(channel => (
					<RailRow key={channel.id} icon={IconHashtag} label={channel.name} count={unreadIn(channel.id)} selected={sel({ kind: "channel", id: channel.id })} onClick={() => onView({ kind: "channel", id: channel.id })} />
				))}
			</RailGroup>
			<RailGroup label="People">{humans.map(memberRow)}</RailGroup>
			<RailGroup label="Agents">{agents.map(memberRow)}</RailGroup>
			{sessions.length > 0 && <RailGroup label="Sessions">{sessions.map(memberRow)}</RailGroup>}
			{naming && (
				<NameDialog
					title="New channel"
					label="Channel name"
					refuse={typed => (state.channels.some(channel => channel.name === channelName(typed)) ? `#${channelName(typed)} already exists.` : null)}
					onSave={createChannel}
					onClose={() => setNaming(false)}
				/>
			)}
		</nav>
	);
}

function RailGroup({ label, action, children }: { label?: string; action?: ReactNode; children: ReactNode }) {
	return (
		<SidebarGroup className={label ? "pt-4 pb-1" : "py-1"}>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			{action}
			<SidebarMenu className="gap-px">{children}</SidebarMenu>
		</SidebarGroup>
	);
}

/** One Board row, a Sessions-list row: `icon` or `leading` its mark, `hint` its tooltip, `count` its badge. */
function RailRow({ icon, leading, label, count = 0, hint, selected, onClick }: { icon?: IconComponent; leading?: ReactNode; label: string; count?: number; hint?: string; selected: boolean; onClick: () => void }) {
	return (
		<SidebarMenuItem>
			<SidebarMenuButton size="short" icon={icon} leading={leading} isActive={selected} title={hint} aria-current={selected || undefined} aria-label={count > 0 ? `${label}, ${count}` : undefined} onClick={onClick}>
				{label}
			</SidebarMenuButton>
			{count > 0 && (
				<SidebarMenuBadge aria-hidden>
					<CountPill count={count} />
				</SidebarMenuBadge>
			)}
		</SidebarMenuItem>
	);
}
