/** The Bots tab: a search field and New Bot, then each Bot as a messaging app lists a conversation. */
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { botAsking, botStatus, type BotRow } from "../../bots-model";
import { mailTime } from "../../labels";
import { hashForBots, hashForNewBot } from "../../routing";
import { SidebarSearch } from "../sidebar-search";
import { BotAvatar } from "./bot-avatar";

interface BotsNavProps {
	/** `null` until the server sends the Bots. */
	rows: readonly BotRow[] | null;
	/** The Bot whose page is open, `null` for the New Bot form, `undefined` while the gallery, another page, or the panes show. */
	openId: string | null | undefined;
}

export function BotsNav({ rows, openId }: BotsNavProps) {
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const shown = rows === null ? [] : needle ? rows.filter(({ bot, preview }) => [bot.name, bot.job, preview].some(text => text.toLowerCase().includes(needle))) : rows;
	return (
		<>
			<SidebarGroup className="flex-row items-center gap-1">
				<div className="min-w-0 flex-1">
					<SidebarSearch label="Filter the Bots" placeholder="Search Bots" query={query} onQuery={setQuery} />
				</div>
				<Tooltip content="New Bot" side="bottom">
					<Button asChild variant="ghost" size="icon-compact" className="shrink-0">
						<a href={hashForNewBot()} aria-label="New Bot" aria-current={openId === null ? "page" : undefined}>
							<Plus />
						</a>
					</Button>
				</Tooltip>
			</SidebarGroup>
			<SidebarContent>
				<SidebarGroup>
					{rows === null ? (
						<p className="px-2 py-1 text-xs text-muted-foreground">Loading your Bots…</p>
					) : rows.length === 0 ? (
						<p className="px-2 py-1 text-xs text-muted-foreground">No Bots yet. Make one with the + button.</p>
					) : shown.length === 0 ? (
						<p className="px-2 py-1 text-xs text-muted-foreground">{`No Bots match “${query.trim()}”`}</p>
					) : (
						<SidebarMenu aria-label="Bots">
							{shown.map(row => (
								<BotRowLink key={row.bot.id} row={row} active={openId === row.bot.id} />
							))}
						</SidebarMenu>
					)}
				</SidebarGroup>
			</SidebarContent>
		</>
	);
}

function BotRowLink({ row: { bot, host, unread, preview, at }, active }: { row: BotRow; active: boolean }) {
	const asking = botAsking(host);
	const when = new Date(at);
	return (
		<SidebarMenuItem>
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
		</SidebarMenuItem>
	);
}
