/** The pieces of a form that saves a service's OAuth client: numbered steps, labelled fields, and outside links. */
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

export const CONTROL = "w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const FIELD = `block h-8 ${CONTROL}`;

export function describedBy(id: string, hint: boolean, error: boolean): string | undefined {
	const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean);
	return ids.length > 0 ? ids.join(" ") : undefined;
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
	return (
		<li className="flex gap-2.5">
			<span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-5 text-[11px] font-medium tabular-nums shadow-surface-2">
				{n}
			</span>
			<span className="pt-px text-pretty">{children}</span>
		</li>
	);
}

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="block text-xs font-medium">
				{label}
			</label>
			{children}
			{hint && (
				<p id={`${id}-hint`} className="text-xs text-pretty text-muted-foreground">
					{hint}
				</p>
			)}
			{error && (
				<p id={`${id}-error`} className="text-xs text-pretty text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}

export function External({ href, children }: { href: string; children: string }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline decoration-border underline-offset-2 hover:decoration-foreground">
			{children}
			<ExternalLink aria-hidden className="size-3" />
		</a>
	);
}
