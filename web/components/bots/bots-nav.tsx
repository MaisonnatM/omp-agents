/** The Bots tab: a search field, All Bots, and New Bot, then each Bot as a messaging app lists a conversation, under Pinned, its section, or Other Bots once any Bot is pinned or in one. */
import { Ellipsis, Folder, FolderMinus, LayoutGrid, type LucideIcon, Pencil, Pin, Plus, UsersRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { SidebarContent, SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { botAsking, type BotGroup, botGroupKey, botGroupLabel, botGroupListName, botGroups, botSections, botsGrouped, botStatus, type BotRow } from "../../bots-model";
import { mailTime } from "../../labels";
import { hashForBots, hashForNewBot } from "../../routing";
import { useStoredKeys } from "../../stored-state";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { SidebarSearch } from "../sidebar-search";
import { BotAvatar } from "./bot-avatar";
import { BotMenu, type SectionNaming, SectionNameDialog } from "./bot-menu";

const COLLAPSED_GROUPS_KEY = "omp-agents.bots-collapsed-groups";

const GROUP_ICONS: Record<BotGroup["kind"], LucideIcon> = { pinned: Pin, section: Folder, rest: UsersRound };

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
	const needle = query.trim().toLowerCase();
	const shown = rows === null ? [] : needle ? rows.filter(({ bot, preview }) => [bot.name, bot.job, preview].some(text => text.toLowerCase().includes(needle))) : rows;
	const bots = rows?.map(({ bot }) => bot) ?? [];
	const sections = botSections(bots);
	const links = (list: readonly BotRow[]) => list.map(row => <BotRowLink key={row.bot.id} row={row} active={openId === row.bot.id} sections={sections} onName={setNaming} />);
	return (
		<>
			<SidebarGroup className="flex-row items-center gap-1">
				<div className="min-w-0 flex-1">
					<SidebarSearch label="Filter the Bots" placeholder="Search Bots" query={query} onQuery={setQuery} />
				</div>
				<Tooltip content="All Bots" side="bottom">
					<Button asChild variant="ghost" size="icon-compact" className="shrink-0">
						<a href={hashForBots(null)} aria-label="All Bots">
							<LayoutGrid />
						</a>
					</Button>
				</Tooltip>
				<Tooltip content="New Bot" side="bottom">
					<Button asChild variant="ghost" size="icon-compact" className="shrink-0">
						<a href={hashForNewBot()} aria-label="New Bot" aria-current={openId === null ? "page" : undefined}>
							<Plus />
						</a>
					</Button>
				</Tooltip>
			</SidebarGroup>
			<SidebarContent>
				{rows === null || shown.length === 0 || !botsGrouped(bots) ? (
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
					botGroups(shown).map(group => {
						const key = botGroupKey(group);
						return (
							<SidebarGroup
								key={key}
								collapsible
								open={!collapsed.has(key)}
								onOpenChange={() => toggleGroup(key)}
								headerActions={group.kind === "section" ? <SectionMenu name={group.name} onName={setNaming} /> : undefined}
							>
								<SidebarGroupLabel icon={GROUP_ICONS[group.kind]}>{botGroupLabel(group)}</SidebarGroupLabel>
								<SidebarMenu aria-label={botGroupListName(group)}>{links(group.rows)}</SidebarMenu>
							</SidebarGroup>
						);
					})
				)}
			</SidebarContent>
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
						<Ellipsis />
					</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent align="end">
					<MenuItem disabled={!connected} onClick={() => onName({ kind: "rename", from: name })}>
						<Pencil />
						Rename section…
					</MenuItem>
					<MenuItem disabled={!connected} onClick={() => changeBot({ op: "rename-section", from: name, to: null })}>
						<FolderMinus />
						Remove section
					</MenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarGroupActions>
	);
}

interface BotRowLinkProps {
	row: BotRow;
	active: boolean;
	sections: readonly string[];
	onName: (naming: SectionNaming) => void;
}

function BotRowLink({ row: { bot, host, unread, preview, at }, active, sections, onName }: BotRowLinkProps) {
	const asking = botAsking(host);
	const when = new Date(at);
	return (
		<BotMenu bot={bot} sections={sections} onName={onName} render={<SidebarMenuItem />}>
			<SidebarMenuButton asChild size="lg" isActive={active} className="h-auto gap-2.5 py-1.5">
				<a href={hashForBots(bot.id)} aria-label={`${bot.name}, ${botStatus(bot, host)}${unread ? ", unread" : ""}. ${preview}`}>
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
