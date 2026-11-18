/** The bar rows of the sidebar's foot, which show plan quota and the machine's load alike. */
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

/** How a figure reads: `out` is used up, `low` is running low. */
export type Tone = "out" | "low" | "ok";

export const TONE_CLASS: Record<Tone, { text: string; bar: string }> = {
	out: { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
	low: { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
	ok: { text: "text-foreground", bar: "bg-foreground/60" },
};

const TILE = "flex w-full min-w-0 flex-col gap-1 rounded-md px-1.5 py-1 text-left tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring";

/** A full-width bar filled to `fill`, 0 to 1, or left empty for `null`. */
export function GaugeBar({ fill, tone }: { fill: number | null; tone: Tone }) {
	return (
		<span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-foreground/10">
			{fill !== null && (
				<span
					className={cn("block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", TONE_CLASS[tone].bar)}
					style={{ width: `${Math.max(0.02, Math.min(1, fill)) * 100}%` }}
				/>
			)}
		</span>
	);
}

interface GaugeTileProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
	/** A button, which opens a card; otherwise a focusable picture, which a tooltip explains. */
	as: "button" | "img";
	/** What a screen reader says for the tile. */
	label: string;
	/** Fraction the bar fills, 0 to 1; `null` leaves it empty. */
	fill: number | null;
	tone: Tone;
	/** What leads the row, such as a provider's logo. */
	icon: ReactNode;
	/** The figure at the row's end, in the tile's tone; `null` shows a dash. */
	value: string | null;
	/** The muted name beside the icon, truncated when long, as an email is. */
	caption: string;
	ref?: Ref<HTMLElement>;
}

/** One row of the foot's list: icon, caption, and figure over a full-width bar; it takes a popover's or a tooltip's trigger props. */
export function GaugeTile({ as, label, fill, tone, icon, value, caption, ref, ...props }: GaugeTileProps) {
	const body = (
		<>
			<span className="flex min-w-0 items-center gap-1.5">
				<span aria-hidden className="grid size-3.5 shrink-0 place-items-center">{icon}</span>
				<span className="min-w-0 flex-1 truncate text-muted-foreground">{caption}</span>
				<span className={cn("shrink-0 font-medium", TONE_CLASS[tone].text)}>{value ?? "—"}</span>
			</span>
			<GaugeBar fill={fill} tone={tone} />
		</>
	);
	if (as === "button") {
		return (
			<button {...props} ref={ref as Ref<HTMLButtonElement>} type="button" aria-label={label} className={TILE}>
				{body}
			</button>
		);
	}
	return (
		<span {...props} ref={ref} tabIndex={0} role="img" aria-label={label} className={TILE}>
			{body}
		</span>
	);
}

/** One row of the foot's list, holding a {@link GaugeTile}. */
export function GaugeCell({ children }: { children: ReactNode }) {
	return <li className="flex min-w-0">{children}</li>;
}
