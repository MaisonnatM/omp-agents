/**
 * The Bots tab: a search field, All Bots, and New Bot, then each Bot as a messaging app lists a conversation, under Pinned, its section, or Other Bots once any Bot is pinned or in one.
 * Dragging a Bot's row onto a group pins it or moves it there.
 */
import { IconDotGrid1x3Horizontal, IconFolder1, IconFolderDelete, IconLayoutGrid1, IconPencil, IconPin, IconPlusLarge, IconUserGroup } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type DragEvent, type HTMLAttributes, type LiHTMLAttributes, useState } from "react";
import type { Bot } from "../../../src/shared/bots";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { botAsking, type BotGroup, botGroupKey, botGroupLabel, botGroupListName, botGroups, botMovesTo, type BotPlace, botSections, botsGrouped, botStatus, type BotRow } from "../../bots-model";
import { mailTime } from "../../labels";
import { hashForBots, hashForNewBot } from "../../routing";
import { useStoredKeys } from "../../stored-state";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { SidebarSearch } from "../sidebar-search";
import { BotAvatar } from "./bot-avatar";
import { BotMenu, type SectionNaming, SectionNameDialog } from "./bot-menu";

const COLLAPSED_GROUPS_KEY = "omp-agents.bots-collapsed-groups";

const GROUP_ICONS: Record<BotGroup["kind"], IconComponent> = { pinned: IconPin, section: IconFolder1, rest: IconUserGroup };

const PINNED: BotPlace = { kind: "pinned" };

const DROP_TARGET = "rounded-lg bg-primary/5 ring-1 ring-primary/40 ring-inset";

/** The Bot whose row is dragged, and the key of the group under it that would take it. */
interface BotDrag {
	bot: Bot;
	over: string | null;
}

interface BotsNavProps {
	/** `null` until the server sends the Bots. */
	rows: readonly BotRow[] | null;
	/** The Bot whose page is open, `null` for the New Bot form, `undefined` while the gallery, another page, or the panes show. */
	openId: string | null | undefined;
}

export function BotsNav({ rows, openId }: BotsNavProps) {
	const [query, setQuery] = useState("");
	const [naming, setNaming] = useState<SectionNaming | null>(null);
	const [collapsed, toggleGroup] = useStoredKeys(COLLAPSED_GROUPS_KEY);
	const [drag, setDrag] = useState<BotDrag | null>(null);
	const { changeBot } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const needle = query.trim().toLowerCase();
	const shown = rows === null ? [] : needle ? rows.filter(({ bot, preview }) => [bot.name, bot.job, preview].some(text => text.toLowerCase().includes(needle))) : rows;
	const bots = rows?.map(({ bot }) => bot) ?? [];
	const sections = botSections(bots);
	const groups = rows !== null && shown.length > 0 && botsGrouped(bots) ? botGroups(shown) : null;
	const handle = (bot: Bot): RowHandle => ({
		draggable: connected,
		onDragStart: (event: DragEvent<HTMLLIElement>) => {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", bot.name);
			setDrag({ bot, over: null });
		},
		onDragEnd: () => setDrag(null),
	});
	const target = (place: BotPlace): HTMLAttributes<HTMLDivElement> => {
		const key = botGroupKey(place);
		const moves = drag && connected ? botMovesTo(drag.bot, place) : [];
		return {
			className: cn(moves.length > 0 && drag?.over === key && DROP_TARGET),
			onDragOver: event => {
				if (moves.length === 0) return;
				event.preventDefault();
				setDrag(now => (now && now.over !== key ? { ...now, over: key } : now));
			},
			onDragLeave: event => {
				// Crossing into one of the group's own rows is not leaving the group.
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
				setDrag(now => (now?.over === key ? { ...now, over: null } : now));
			},
			onDrop: event => {
				if (moves.length === 0) return;
				event.preventDefault();
				for (const change of moves) changeBot(change);
				setDrag(null);
			},
		};
	};
	const links = (list: readonly BotRow[]) =>
		list.map(row => <BotRowLink key={row.bot.id} row={row} active={openId === row.bot.id} sections={sections} onName={setNaming} handle={handle(row.bot)} dragging={drag?.bot.id === row.bot.id} />);
	return (
		<>
			<SidebarGroup className="flex-row items-center gap-1">
				<div className="min-w-0 flex-1">
					<SidebarSearch label="Filter the Bots" placeholder="Search Bots" query={query} onQuery={setQuery} />
				</div>
				<Tooltip content="All Bots" side="bottom">
					<Button asChild variant="ghost" size="icon-compact" className="shrink-0">
						<a href={hashForBots(null)} aria-label="All Bots">
							<IconLayoutGrid1 />
						</a>
					</Button>
				</Tooltip>
				<Tooltip content="New Bot" side="bottom">
					<Button asChild variant="ghost" size="icon-compact" className="shrink-0">
						<a href={hashForNewBot()} aria-label="New Bot" aria-current={openId === null ? "page" : undefined}>
							<IconPlusLarge />
						</a>
					</Button>
				</Tooltip>
			</SidebarGroup>
			<div className="flex w-full min-w-0 flex-col">
				{drag && connected && !groups?.some(({ kind }) => kind === "pinned") && (
					<SidebarGroup {...target(PINNED)}>
						<SidebarGroupLabel icon={GROUP_ICONS.pinned}>{botGroupLabel(PINNED)}</SidebarGroupLabel>
						<p className="rounded-md border border-dashed border-primary/50 px-2 py-3 text-center text-xs text-primary">Drop a Bot here to pin it</p>
					</SidebarGroup>
				)}
				{groups === null ? (
					<SidebarGroup>
						{rows === null ? (
							<p className="px-2 py-1 text-xs text-muted-foreground">Loading your Bots…</p>
						) : rows.length === 0 ? (
							<p className="px-2 py-1 text-xs text-muted-foreground">No Bots yet. Make one with the + button.</p>
						) : shown.length === 0 ? (
							<p className="px-2 py-1 text-xs text-muted-foreground">{`No Bots match “${query.trim()}”`}</p>
						) : (
							<SidebarMenu aria-label="Bots">{links(shown)}</SidebarMenu>
						)}
					</SidebarGroup>
				) : (
					groups.map(group => {
						const key = botGroupKey(group);
						return (
							<SidebarGroup
								key={key}
								collapsible
								open={!collapsed.has(key)}
								onOpenChange={() => toggleGroup(key)}
								headerActions={group.kind === "section" ? <SectionMenu name={group.name} onName={setNaming} /> : undefined}
								{...target(group)}
							>
								<SidebarGroupLabel icon={GROUP_ICONS[group.kind]}>{botGroupLabel(group)}</SidebarGroupLabel>
								<SidebarMenu aria-label={botGroupListName(group)}>{links(group.rows)}</SidebarMenu>
							</SidebarGroup>
						);
					})
				)}
			</div>
			{naming && <SectionNameDialog naming={naming} onClose={() => setNaming(null)} />}
		</>
	);
}

/** A section header's ⋯ menu: rename the section, or remove it, which moves its Bots to Other Bots. */
function SectionMenu({ name, onName }: { name: string; onName: (naming: SectionNaming) => void }) {
	const [open, setOpen] = useState(false);
	const { changeBot } = useDashboardActions();
	const { connected } = useDashboardStatus();
	return (
		<SidebarGroupActions>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<Tooltip content="Section actions" forceOpen={open ? false : undefined}>
					<DropdownMenuTrigger render={<SidebarGroupAction aria-label={`Actions for the ${name} section`} />}>
						<IconDotGrid1x3Horizontal />
					</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent align="end">
					<MenuItem disabled={!connected} onClick={() => onName({ kind: "rename", from: name })}>
						<IconPencil />
						Rename section…
					</MenuItem>
					<MenuItem disabled={!connected} onClick={() => changeBot({ op: "rename-section", from: name, to: null })}>
						<IconFolderDelete />
						Remove section
					</MenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarGroupActions>
	);
}

/** What a row's `<li>` takes to be dragged onto a group. */
type RowHandle = Pick<LiHTMLAttributes<HTMLLIElement>, "draggable" | "onDragStart" | "onDragEnd">;

interface BotRowLinkProps {
	row: BotRow;
	active: boolean;
	sections: readonly string[];
	onName: (naming: SectionNaming) => void;
	handle: RowHandle;
	dragging: boolean;
}

function BotRowLink({ row: { bot, host, unread, preview, at }, active, sections, onName, handle, dragging }: BotRowLinkProps) {
	const asking = botAsking(host);
	const when = new Date(at);
	return (
		<BotMenu bot={bot} sections={sections} onName={onName} render={<SidebarMenuItem {...handle} className={cn(dragging && "opacity-50")} />}>
			<SidebarMenuButton asChild size="lg" isActive={active} className="h-auto gap-2.5 py-1.5">
				<a
					href={hashForBots(bot.id)}
					// The row drags, not the link's address.
					draggable={false}
					aria-label={`${bot.name}, ${botStatus(bot, host)}${unread ? ", unread" : ""}. ${preview}`}
				>
					<BotAvatar look={bot} size="row" working={host?.status === "working"} asking={asking !== null} />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex items-baseline gap-2">
							<span className={cn("truncate text-foreground", unread ? "font-semibold" : "font-medium")}>{bot.name}</span>
							<time dateTime={when.toISOString()} className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
								{mailTime(at)}
							</time>
						</span>
						<span className="flex items-center gap-2">
							<span className={cn("truncate text-xs", asking ? "text-amber-700 dark:text-amber-400" : unread ? "text-foreground" : "text-muted-foreground")}>{preview}</span>
							{unread && <span aria-hidden className="ml-auto size-2 shrink-0 rounded-full bg-primary" />}
						</span>
					</span>
				</a>
			</SidebarMenuButton>
		</BotMenu>
	);
}
