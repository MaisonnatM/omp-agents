/** The Sessions tab's Bots group, and the avatar that stands for a Bot there and on its page. */
import { Bot as BotIcon, Plus } from "lucide-react";
import type { Bot } from "../../../src/shared/bots";
import type { HostStatus } from "../../../src/shared/sessions";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { botHue, botInitial } from "../../bots-model";
import { hashForBots } from "../../routing";
import { StatusDot, statusLabel } from "../status-dot";

const AVATAR_SIZE = { row: "size-5 text-[10px]", header: "size-7 text-xs", panel: "size-9 text-sm" } as const;

/** The Bot's first letter on a disc of its own color. */
export function BotAvatar({ bot, size }: { bot: Pick<Bot, "id" | "name">; size: keyof typeof AVATAR_SIZE }) {
	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", AVATAR_SIZE[size])}
			style={{ backgroundColor: `oklch(0.58 0.13 ${botHue(bot.id)})` }}
		>
			{botInitial(bot.name)}
		</span>
	);
}

/** A Bot as the sidebar lists it, with the status of its running session, `null` while none runs. */
export interface BotEntry {
	bot: Bot;
	status: HostStatus | null;
}

interface BotsGroupProps {
	bots: readonly BotEntry[];
	/** The Bot whose page is open, `null` for the New Bot form, `undefined` while another page or the panes show. */
	openId: string | null | undefined;
	open: boolean;
	onOpenChange: () => void;
}

/** Each Bot, a link to its page with its running session's status, then New Bot. */
export function BotsGroup({ bots, openId, open, onOpenChange }: BotsGroupProps) {
	return (
		<SidebarGroup collapsible open={open} onOpenChange={onOpenChange}>
			<SidebarGroupLabel icon={BotIcon}>Bots</SidebarGroupLabel>
			<SidebarMenu aria-label="Bots">
				{bots.map(({ bot, status }) => {
					const active = openId === bot.id;
					return (
						<SidebarMenuItem key={bot.id}>
							<SidebarMenuButton asChild isActive={active}>
								<a href={hashForBots(bot.id)} aria-current={active ? "page" : undefined} aria-label={`${bot.name}, ${status ? statusLabel(status) : "not running"}`}>
									<BotAvatar bot={bot} size="row" />
									<span className="truncate">{bot.name}</span>
								</a>
							</SidebarMenuButton>
							{status && (
								<SidebarMenuBadge aria-hidden>
									<StatusDot status={status} />
								</SidebarMenuBadge>
							)}
						</SidebarMenuItem>
					);
				})}
				<SidebarMenuItem>
					<SidebarMenuButton asChild isActive={openId === null}>
						<a href={hashForBots(null)} aria-current={openId === null ? "page" : undefined} className="text-muted-foreground">
							<Plus className="size-4" />
							<span className="truncate">New Bot</span>
						</a>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarGroup>
	);
}
