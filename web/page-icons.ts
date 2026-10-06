import { BarChart3, CalendarClock, Inbox, ListTodo, type LucideIcon, MessagesSquare, SquareKanban } from "lucide-react";

/** The icon of each page of the dashboard: its sidebar tab shows it, and so does every link that opens something on it. */
export const PAGE_ICON = {
	inbox: Inbox,
	tickets: SquareKanban,
	sessions: MessagesSquare,
	todo: ListTodo,
	routines: CalendarClock,
	analytics: BarChart3,
} as const satisfies Record<string, LucideIcon>;
