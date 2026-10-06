import { Ellipsis, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BrandLogo } from "./brand-logos";

/** Integration rows on one raised surface, a hairline between rows. */
export function IntegrationList({ label, children }: { label: string; children: ReactNode }) {
	return (
		<ul aria-label={label} className="divide-y divide-border overflow-hidden rounded-xl bg-surface-3 shadow-surface-2">
			{children}
		</ul>
	);
}

interface IntegrationRowProps {
	name: string;
	logo: BrandLogo;
	status: ReactNode;
	/** What connecting it gives you. */
	summary: string;
	/** Where the connection lives, as short facts under the summary. */
	meta: ReactNode;
	actions: ReactNode;
	/** Callouts, tools, and forms under the row, aligned with its text. */
	children?: ReactNode;
}

/** One integration: its brand mark, name, status, and buttons, then whatever it has to say under them. */
export function IntegrationRow({ name, logo, status, summary, meta, actions, children }: IntegrationRowProps) {
	return (
		<li aria-label={name} className="p-4">
			<div className="flex items-start gap-3.5">
				<span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-5 shadow-surface-2">
					<svg viewBox="0 0 24 24" className="size-5" fill={logo.color}>
						<path d={logo.path} />
					</svg>
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h3 className="text-[13px] font-medium">{name}</h3>
						{status}
					</div>
					<p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">{summary}</p>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">{meta}</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">{actions}</div>
			</div>
			{children && <div className="mt-3 space-y-3 sm:pl-[54px]">{children}</div>}
		</li>
	);
}

/** A dot between two of a row's meta facts. */
export const MetaDot = () => <span aria-hidden>·</span>;

const TONE = {
	info: "bg-blue-500/[0.06] text-blue-950 ring-blue-500/15 dark:text-blue-100 [&_svg]:text-blue-600 dark:[&_svg]:text-blue-400",
	warning: "bg-amber-500/[0.08] text-amber-950 ring-amber-500/20 dark:text-amber-100 [&_svg]:text-amber-600 dark:[&_svg]:text-amber-400",
	danger: "bg-red-500/[0.06] text-red-950 ring-red-500/15 dark:text-red-100 [&_svg]:text-red-600 dark:[&_svg]:text-red-400",
};

interface CalloutProps {
	tone: keyof typeof TONE;
	icon: LucideIcon;
	/** Spins the icon, while the callout waits on something. */
	spin?: boolean;
	/** A button that resolves what the callout says, at its end. */
	action?: ReactNode;
	children: ReactNode;
}

/** A tinted note inside a row: a sign-in waiting on you, or why the connection fails. */
export function Callout({ tone, icon: Icon, spin = false, action, children }: CalloutProps) {
	return (
		<div role={tone === "info" ? "status" : "alert"} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-[13px] ring-1 ring-inset", TONE[tone])}>
			<div className="flex min-w-0 flex-1 basis-64 items-start gap-2.5">
				<Icon className={cn("mt-0.5 size-4 shrink-0", spin && "motion-safe:animate-spin")} aria-hidden />
				<div className="min-w-0 text-pretty">{children}</div>
			</div>
			{action && <div className="ms-auto shrink-0 [&_svg]:text-current">{action}</div>}
		</div>
	);
}

/** A row's ⋯ menu, for the actions too rare to sit on the row. */
export function RowMenu({ name, disabled, children }: { name: string; disabled?: boolean; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="More actions" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={`More actions for ${name}`} disabled={disabled} />}>
					<Ellipsis />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">{children}</DropdownMenuContent>
		</DropdownMenu>
	);
}
