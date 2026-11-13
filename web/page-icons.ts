import { IconAiBotHead, IconBubbles, IconCalendarClock, IconDumbell, IconEmail1, IconKanbanView, IconPullRequest, IconSettingsGear1, IconSuitcaseWork, IconTodos, IconUser } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import type { Space } from "../src/shared/workspaces";

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
	settings: IconSettingsGear1,
} as const satisfies Record<string, IconComponent>;

/** The icon of each space, on the title bar's switch and wherever something is placed in one. */
export const SPACE_ICONS: Record<Space, IconComponent> = { personal: IconUser, work: IconSuitcaseWork };
