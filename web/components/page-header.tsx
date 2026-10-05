import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface HeaderProps {
	title: string;
	meta: ReactNode;
	status?: string;
	alert?: boolean;
	children?: ReactNode;
}

/** The title, one meta line, and controls that head a pane or a page. */
export function Header({ title, meta, status, alert = false, children }: HeaderProps) {
	return (
		<header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
			<div className="min-w-0">
				<h2 className="truncate text-sm font-semibold">{title}</h2>
				<p className="truncate text-xs text-muted-foreground">{meta}</p>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{status !== undefined && (
					<span className={cn("text-xs", alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} data-status>
						{status}
					</span>
				)}
				{children}
			</div>
		</header>
	);
}
