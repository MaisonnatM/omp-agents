/** The report tables of Settings › Analytics and Settings › Activity: the table, its row heading, a text cell, and a number cell. */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** `wide` keeps a many-column table legible by scrolling it sideways on narrow screens; the first `textColumns` align to the start. */
export function Table({ label, columns, textColumns = 1, wide = false, children }: { label: string; columns: string[]; textColumns?: number; wide?: boolean; children: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<table className={`w-full text-sm ${wide ? "min-w-[40rem]" : ""}`}>
				<caption className="sr-only">{label}</caption>
				<thead className="text-xs text-muted-foreground">
					<tr>{columns.map((column, index) => <th key={column} scope="col" className={`pb-2 font-medium ${index === 0 ? "text-start" : index < textColumns ? "ps-4 text-start" : "ps-4 text-end"}`}>{column}</th>)}</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	);
}

/** A row's heading cell; `className` adds a width or truncation. */
export function RowHead({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
	return <th scope="row" className={cn("border-t border-border py-2 text-start font-medium", className)} title={title}>{children}</th>;
}

/** A text cell after the heading, muted when it qualifies the row, such as a kind. */
export function Text({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
	return <td className={cn("border-t border-border py-2 ps-4 text-start", muted && "text-muted-foreground")}>{children}</td>;
}

export function Count({ children, title }: { children: ReactNode; title?: string }) {
	return <td className="whitespace-nowrap border-t border-border py-2 ps-4 text-end tabular-nums" title={title}>{children}</td>;
}
