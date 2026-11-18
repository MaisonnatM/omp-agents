/** `ApprovalCard`, after affectUI's approval card: a request to act, as a white card on a muted tray whose foot holds the answers. */
import { IconShield } from "central-icons";
import type { HTMLAttributes, ReactNode } from "react";
import { fontWeights } from "@/lib/font-weight";
import { cn } from "@/lib/utils";

interface ApprovalCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
	title: string;
	/** Context under the title, kept to its own line breaks. */
	description?: ReactNode;
	/** The 32px tile's glyph; a shield when left out. */
	icon?: ReactNode;
	/** The tray's row above the card. */
	label?: ReactNode;
	/** The tray's foot under the card: the answer buttons. */
	actions: ReactNode;
}

/** The tray holds a label row, the card, and a foot of buttons; the card holds the icon tile, title, description, and an optional preview as children. */
export function ApprovalCard({ title, description, icon, label, actions, children, className, ...rest }: ApprovalCardProps) {
	return (
		<div role="group" aria-label={title} className={cn("w-full rounded-[20px] bg-muted p-1", className)} {...rest}>
			{label && <div className="flex min-h-7 items-center gap-2 px-2 pt-1 pb-1.5 text-[12.5px] text-muted-foreground">{label}</div>}
			<div className="rounded-2xl bg-card p-4 shadow-surface-2">
				<div className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3">
					<span aria-hidden className="flex size-8 items-center justify-center rounded-[9px] text-foreground ring-1 ring-border ring-inset">
						{icon ?? <IconShield className="size-4" />}
					</span>
					<div className="flex min-w-0 flex-col gap-0.5 pt-px">
						<h3 className="truncate text-[14px] leading-5 text-foreground" style={{ fontVariationSettings: fontWeights.semibold }}>
							{title}
						</h3>
						{description && <div className="text-[13px] leading-snug whitespace-pre-wrap text-muted-foreground">{description}</div>}
					</div>
				</div>
				{children && <div className="mt-3.5 border-t border-border pt-3.5">{children}</div>}
			</div>
			<div className="flex min-h-11 flex-wrap items-center justify-end gap-1 pt-1.5 pr-0.5 pb-0.5 pl-2.5">{actions}</div>
		</div>
	);
}

/** A button's key hint, as affectUI's approval card draws it: tinted by the button's own text color. */
export function KeyHint({ children }: { children: ReactNode }) {
	return <kbd aria-hidden className="hidden h-5 min-w-5 items-center justify-center rounded-[6px] bg-current/12 px-1.5 font-sans text-[11px] leading-none tabular-nums sm:inline-flex">{children}</kbd>;
}
