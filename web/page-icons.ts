import { Bot, Briefcase, CalendarClock, Dumbbell, GitPullRequest, ListTodo, type LucideIcon, Mail, MessagesSquare, Settings, SquareKanban, UserRound } from "lucide-react";
import type { Space } from "../src/shared/workspaces";

/** The icon of each page of the dashboard: its sidebar tab shows it, and so does every link that opens something on it. */
export const PAGE_ICON = {
	"pull-requests": GitPullRequest,
	tickets: SquareKanban,
	bots: Bot,
	sessions: MessagesSquare,
	todo: ListTodo,
	calendar: CalendarClock,
	email: Mail,
	sport: Dumbbell,
	settings: Settings,
} as const satisfies Record<string, LucideIcon>;

/** The icon of each space, on the title bar's switch and wherever something is placed in one. */
export const SPACE_ICONS: Record<Space, LucideIcon> = { personal: UserRound, work: Briefcase };
