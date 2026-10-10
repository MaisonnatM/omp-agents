import { CalendarClock, FolderKanban, GitPullRequest, ListTodo, type LucideIcon, MessagesSquare, Settings, SquareKanban } from "lucide-react";

/** The icon of each page of the dashboard: its sidebar tab shows it, and so does every link that opens something on it. */
export const PAGE_ICON = {
	"pull-requests": GitPullRequest,
	tickets: SquareKanban,
	sessions: MessagesSquare,
	todo: ListTodo,
	calendar: CalendarClock,
	projects: FolderKanban,
	settings: Settings,
} as const satisfies Record<string, LucideIcon>;
