/** The left sidebar's Board mode: the inbox, schedules, channels, and members, in the Sessions list's rows. */
import { IconBell, IconCalendar1, IconHashtag, IconLock } from "central-icons";
import { useMemo, type ReactNode } from "react";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { IconComponent } from "@/lib/icon-context";
import type { RosterHost } from "../../../src/shared/sessions";
import { type BoardState, boardMembers, type Member, queueOf, unreadIn } from "../../../src/shared/board";
import { CountPill } from "../count-pill";
import { hashForPage } from "../../routing";
import { type BoardRoute, type BoardView, resolveBoardView } from "./module";
import { Avatar, relTime, useNow } from "./parts";

/** The Board's own list, which the left sidebar shows in its Board mode; `route` is the route the Board shows, and nothing renders until its state loads. */
export function BoardNav({ state, hosts, route }: { state: BoardState | null; hosts: RosterHost[]; route: BoardRoute }) {
	const now = useNow();
	const members = useMemo(() => (state ? boardMembers(state, hosts) : []), [state, hosts]);
	if (!state) return null;
	const me = members.find(member => member.id === state.me)!;
	const view = resolveBoardView(state, new Map(members.map(member => [member.id, member])), route.view);
	return <Rail state={state} members={members} me={me} now={now} inboxCount={queueOf(state, me).length} view={view} onView={next => (location.hash = hashForPage({ kind: "board", view: next, thread: null }))} />;
}

function Rail({ state, members, view, onView, me, now, inboxCount }: { state: BoardState; members: Member[]; view: BoardView; onView: (view: BoardView) => void; me: Member; now: number; inboxCount: number }) {
	const sel = (other: BoardView) => view.kind === other.kind && ("id" in view ? "id" in other && view.id === other.id : true);
	const humans = members.filter(member => member.kind === "human");
	const agents = members.filter(member => member.kind !== "human");
	const memberRow = (member: Member) => (
		<RailRow
			key={member.id}
			icon={avatarIcon(member)}
			label={member.id === me.id ? `${member.name} (you)` : member.name}
			hint={member.kind === "human" ? `${member.name} · ${member.presence === "online" ? "Online" : "Away"}` : `${member.name} · ${member.harness}`}
			count={queueOf(state, member).length}
			selected={sel({ kind: "member", id: member.id })}
			onClick={() => onView({ kind: "member", id: member.id })}
		/>
	);
	return (
		<nav aria-label="Board" className="pb-2">
			<RailGroup>
				<RailRow icon={IconBell} label="Inbox" count={inboxCount} selected={sel({ kind: "inbox" })} onClick={() => onView({ kind: "inbox" })} />
				<RailRow
					icon={IconCalendar1}
					label="Scheduled"
					hint={state.schedules.length > 0 ? relTime(Math.min(...state.schedules.map(item => item.at)), now) : undefined}
					selected={sel({ kind: "scheduled" })}
					onClick={() => onView({ kind: "scheduled" })}
				/>
			</RailGroup>
			<RailGroup label="Channels">
				{state.channels.map(channel => (
					<RailRow
						key={channel.id}
						icon={channel.restricted ? IconLock : IconHashtag}
						label={channel.name}
						hint={channel.sync ? `Synced to ${channel.sync}` : undefined}
						count={state.threads.filter(thread => thread.channel === channel.id).reduce((sum, thread) => sum + unreadIn(state, thread.id), 0)}
						selected={sel({ kind: "channel", id: channel.id })}
						onClick={() => onView({ kind: "channel", id: channel.id })}
					/>
				))}
			</RailGroup>
			<RailGroup label="People">{humans.map(memberRow)}</RailGroup>
			<RailGroup label="Agents">{agents.map(memberRow)}</RailGroup>
		</nav>
	);
}

function RailGroup({ label, children }: { label?: string; children: ReactNode }) {
	return (
		<SidebarGroup className={label ? "pt-4 pb-1" : "py-1"}>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarMenu className="gap-px">{children}</SidebarMenu>
		</SidebarGroup>
	);
}

/** Each member's latest row, which its avatar icon reads, so the icon stays one component per member and never remounts. */
const latestMember = new Map<string, Member>();
const avatarIcons = new Map<string, IconComponent>();

/** A member's avatar, shrunk to the icon slot of a sidebar row. */
function avatarIcon(member: Member): IconComponent {
	latestMember.set(member.id, member);
	let icon = avatarIcons.get(member.id);
	if (!icon) {
		icon = function MemberAvatar() {
			return <Avatar member={latestMember.get(member.id)!} size="xs" />;
		};
		avatarIcons.set(member.id, icon);
	}
	return icon;
}

/** One Board row, a Sessions-list row: `hint` is its tooltip, `count` its badge. */
function RailRow({ icon, label, count = 0, hint, selected, onClick }: { icon: IconComponent; label: string; count?: number; hint?: string; selected: boolean; onClick: () => void }) {
	return (
		<SidebarMenuItem>
			<SidebarMenuButton size="short" icon={icon} isActive={selected} title={hint} aria-current={selected || undefined} aria-label={count > 0 ? `${label}, ${count}` : undefined} onClick={onClick}>
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
