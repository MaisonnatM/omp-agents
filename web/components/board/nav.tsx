/** The left sidebar's Board mode: the inbox, schedules, channels, and members. */
import { IconBell, IconCalendar1, IconHashtag, IconLock } from "central-icons";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RosterHost } from "../../../src/shared/sessions";
import { type BoardState, boardMembers, type Member, queueOf, unreadIn } from "../../../src/shared/board";
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
	return <Rail state={state} members={members} me={me} now={now} inboxCount={queueOf(state, me).length} view={view} onView={next => (location.hash = hashForPage({ kind: "board", view: next }))} />;
}

function Rail({ state, members, view, onView, me, now, inboxCount }: { state: BoardState; members: Member[]; view: BoardView; onView: (view: BoardView) => void; me: Member; now: number; inboxCount: number }) {
	const sel = (other: BoardView) => view.kind === other.kind && ("id" in view ? "id" in other && view.id === other.id : true);
	const humans = members.filter(member => member.kind === "human");
	const agents = members.filter(member => member.kind !== "human");
	return (
		<nav aria-label="Board" className="pb-2">
			<RailRow icon={<IconBell className="size-4" />} label="Inbox" count={inboxCount} accent selected={sel({ kind: "inbox" })} onClick={() => onView({ kind: "inbox" })} />
			<RailRow
				icon={<IconCalendar1 className="size-4" />}
				label="Scheduled"
				hint={relTime(Math.min(...state.schedules.map(item => item.at)), now)}
				selected={sel({ kind: "scheduled" })}
				onClick={() => onView({ kind: "scheduled" })}
			/>
			<RailHeading>Channels</RailHeading>
			{state.channels.map(channel => {
				const unread = state.threads.filter(thread => thread.channel === channel.id).reduce((sum, thread) => sum + unreadIn(state, thread.id), 0);
				return (
					<RailRow
						key={channel.id}
						icon={channel.restricted ? <IconLock className="size-3.5" /> : <IconHashtag className="size-3.5" />}
						label={channel.name}
						count={unread}
						bold={unread > 0}
						trailing={channel.sync && <SyncDot sync={channel.sync} />}
						selected={sel({ kind: "channel", id: channel.id })}
						onClick={() => onView({ kind: "channel", id: channel.id })}
					/>
				);
			})}
			<RailHeading>People</RailHeading>
			{humans.map(member => (
				<MemberRow key={member.id} member={member} isMe={member.id === me.id} queued={queueOf(state, member).length} selected={sel({ kind: "member", id: member.id })} onClick={() => onView({ kind: "member", id: member.id })} />
			))}
			<RailHeading>Agents</RailHeading>
			{agents.map(member => (
				<MemberRow key={member.id} member={member} queued={queueOf(state, member).length} selected={sel({ kind: "member", id: member.id })} onClick={() => onView({ kind: "member", id: member.id })} />
			))}
		</nav>
	);
}

function RailHeading({ children }: { children: ReactNode }) {
	return <p className="mt-4 mb-1 px-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>;
}

function RailRow({ icon, label, count = 0, hint, accent, bold, trailing, selected, onClick }: { icon: ReactNode; label: string; count?: number; hint?: string; accent?: boolean; bold?: boolean; trailing?: ReactNode; selected: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={selected || undefined}
			className={cn(
				"flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
				selected && "bg-accent text-foreground",
				bold && "font-medium text-foreground",
			)}
		>
			<span className="grid size-4 shrink-0 place-items-center">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{trailing}
			{hint && <span className="text-2xs tabular-nums text-muted-foreground">{hint}</span>}
			{count > 0 && <span className={cn("min-w-5 rounded-full px-1.5 text-center text-2xs font-semibold tabular-nums leading-5", accent ? "bg-primary text-primary-foreground" : "bg-foreground/10 text-foreground")}>{count}</span>}
		</button>
	);
}

function MemberRow({ member, isMe, queued, selected, onClick }: { member: Member; isMe?: boolean; queued: number; selected: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={selected || undefined}
			className={cn("group flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent", selected && "bg-accent")}
		>
			<Avatar member={member} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm leading-tight">
					{member.name}
					{isMe && <span className="text-muted-foreground"> (you)</span>}
				</span>
				<span className="block truncate text-3xs leading-tight text-muted-foreground">{member.kind === "human" ? (member.presence === "online" ? "Online" : "Away") : member.harness}</span>
			</span>
			{queued > 0 && (
				<span title={`${queued} waiting in ${member.name}'s inbox`} className={cn("rounded px-1 text-3xs font-medium tabular-nums leading-4", member.presence === "asleep" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-foreground/10")}>
					{queued}
				</span>
			)}
		</button>
	);
}

function SyncDot({ sync }: { sync: "slack" | "github" | "linear" }) {
	return <span title={`Two-way sync with ${sync}`} className="rounded border border-border px-1 text-3xs leading-4 text-muted-foreground">{sync}</span>;
}
