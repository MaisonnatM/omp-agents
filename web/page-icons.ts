import { IconAiBotHead, IconBubbles, IconEmail1, IconKanbanView, IconPullRequest, IconSettingsGear1, IconTodos } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";

/** The icon of each page of the core: its sidebar tab shows it, and so does every link that opens something on it. A module's tab names its own. */
export const PAGE_ICON = {
	"pull-requests": IconPullRequest,
	tickets: IconKanbanView,
	bots: IconAiBotHead,
	sessions: IconBubbles,
	todo: IconTodos,
	email: IconEmail1,
	settings: IconSettingsGear1,
} as const satisfies Record<string, IconComponent>;
