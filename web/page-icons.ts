import { IconAiBotHead, IconBell, IconBubbles, IconCalendarClock, IconDumbell, IconEmail1, IconKanbanView, IconPullRequest, IconSettingsGear1, IconSparklesTwo, IconTodos } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";

/** The icon of each page of the dashboard: its sidebar tab shows it, and so does every link that opens something on it. */
export const PAGE_ICON = {
	"pull-requests": IconPullRequest,
	tickets: IconKanbanView,
	bots: IconAiBotHead,
	sessions: IconBubbles,
	todo: IconTodos,
	calendar: IconCalendarClock,
	email: IconEmail1,
	sport: IconDumbell,
	notifications: IconBell,
	settings: IconSettingsGear1,
} as const satisfies Record<string, IconComponent>;
