import { Bot, CalendarClock, GitPullRequest, ListTodo, type LucideIcon, Mail, MessagesSquare, NotebookPen, Settings, SquareKanban } from "lucide-react";

/** The icon of each page of the dashboard: its sidebar tab shows it, and so does every link that opens something on it. */
export const PAGE_ICON = {
	"pull-requests": GitPullRequest,
	tickets: SquareKanban,
	bots: Bot,
	sessions: MessagesSquare,
	todo: ListTodo,
	notes: NotebookPen,
	calendar: CalendarClock,
	email: Mail,
	settings: Settings,
} as const satisfies Record<string, LucideIcon>;
