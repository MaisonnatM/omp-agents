import { Inbox, ListTodo, MessagesSquare, SquareKanban } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { TabItem, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import favicon from "../favicon.svg";
import { shortcutLabels } from "../shortcuts";

const NAVIGATION_TABS = [
	{ value: "inbox", label: "Inbox", icon: Inbox },
	{ value: "tickets", label: "Tickets", icon: SquareKanban },
	{ value: "sessions", label: "Sessions", icon: MessagesSquare },
	{ value: "todo", label: "Todo", icon: ListTodo },
] as const;

/** The inbox, tickets, and todo pages, or the session panes. */
export type SidebarTab = (typeof NAVIGATION_TABS)[number]["value"];

interface NavigationTabsProps {
	ticketsShown: boolean;
	compact?: boolean;
	className?: string;
}

export function NavigationTabs({ ticketsShown, compact = false, className }: NavigationTabsProps) {
	return (
		<SizeProvider size={compact ? "compact" : "default"}>
			<TabsList aria-label="Dashboard" className={className}>
				{NAVIGATION_TABS.filter(({ value }) => ticketsShown || value !== "tickets").map(({ value, label, icon }) => (
					<TabItem key={value} value={value} label={label} icon={icon} className={compact ? "px-2" : undefined} shortcut={shortcutLabels(value)} />
				))}
			</TabsList>
		</SizeProvider>
	);
}

interface DashboardHeaderProps {
	ticketsShown: boolean;
	sidebarOpen: boolean;
}

export function DashboardHeader({ ticketsShown, sidebarOpen }: DashboardHeaderProps) {
	const { isMobile } = useSidebar();
	if (isMobile && sidebarOpen) return null;
	return (
		<header className="flex shrink-0 items-center gap-4 border-b border-border px-2 py-2 md:px-4">
			<img src={favicon} alt="omp agents" className="hidden size-7 shrink-0 md:block" />
			<div className="min-w-0 overflow-x-auto">
				<NavigationTabs ticketsShown={ticketsShown} compact={isMobile} />
			</div>
		</header>
	);
}
