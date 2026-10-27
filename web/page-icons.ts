import { CalendarClock, GitPullRequest, ListTodo, type LucideIcon, Mail, MessagesSquare, NotebookPen, Repeat, Settings, SquareKanban } from "lucide-react";

/** The icon of each page of the dashboard: its sidebar tab shows it, and so does every link that opens something on it. */
export const PAGE_ICON = {
	"pull-requests": GitPullRequest,
	tickets: SquareKanban,
	sessions: MessagesSquare,
	todo: ListTodo,
	routines: Repeat,
	notes: NotebookPen,
	calendar: CalendarClock,
	email: Mail,
	settings: Settings,
} as const satisfies Record<string, LucideIcon>;
