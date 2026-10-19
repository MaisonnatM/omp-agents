/** The command palette's bottom bar, with its footer buttons. */
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ENTER } from "../../command-palette";
import { chordLabel } from "../../shortcuts";
import { Kbd } from "../kbd";

/** A footer button: an action's title, then its key chip. */
export function FooterButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50", className)}
			{...props}
		/>
	);
}

interface PaletteFooterProps {
	/** The view's icon and title. */
	icon: LucideIcon;
	title: string;
	/** The highlighted item's first action, which Enter runs, or `null` while none is highlighted. */
	primary: string | null;
	onPrimary: () => void;
	/** The Actions button, with the panel it opens. */
	children: ReactNode;
}

/** The palette's bottom bar: where you are, what Enter does, and the way to every other action. */
export function PaletteFooter({ icon: Icon, title, primary, onPrimary, children }: PaletteFooterProps) {
	return (
		<div className="relative flex h-10 shrink-0 items-center gap-2 border-t border-border pr-1.5 pl-3 text-xs">
			<span className="flex min-w-0 items-center gap-2 text-muted-foreground">
				<Icon className="size-3.5 shrink-0" />
				<span className="truncate">{title}</span>
			</span>
			<span className="ml-auto flex shrink-0 items-center gap-1">
				{primary !== null && (
					<>
						<FooterButton onClick={onPrimary}>
							{primary}
							<Kbd>{chordLabel(ENTER)}</Kbd>
						</FooterButton>
						<span aria-hidden className="mx-1 h-4 w-px bg-border" />
					</>
				)}
				{children}
			</span>
		</div>
	);
}
