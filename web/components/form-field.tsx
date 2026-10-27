/** The labeled fields of a page's form, as the routine editor and the New Bot form lay them out. */
import type { ReactNode } from "react";

/** A one-line text field's classes. */
export const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** A text area's classes. */
export const TEXT_AREA = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A labeled part of the form; `hint` explains it under the control. */
export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
	const Label = htmlFor ? "label" : "p";
	return (
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor} className="block text-sm font-medium">
				{label}
			</Label>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}
