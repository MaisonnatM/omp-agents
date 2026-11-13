/** The ring tiles of the sidebar's foot, which show plan quota and the machine's load alike. */
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

/** How a figure reads: `out` is used up, `low` is running low. */
export type Tone = "out" | "low" | "ok";

export const TONE_CLASS: Record<Tone, { text: string; bar: string; ring: string }> = {
	out: { text: "text-red-600 dark:text-red-400", bar: "bg-red-500", ring: "stroke-red-500" },
	low: { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", ring: "stroke-amber-500" },
	ok: { text: "text-foreground", bar: "bg-foreground/60", ring: "stroke-foreground/60" },
};

const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const TILE = "flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring";

/** An icon inside a ring filled to `fill`, 0 to 1, or left empty for `null`. */
function GaugeRing({ fill, tone, children }: { fill: number | null; tone: Tone; children: ReactNode }) {
	return (
		<span aria-hidden className="relative grid size-8 place-items-center">
			<svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
				<circle cx="16" cy="16" r={RING_RADIUS} fill="none" strokeWidth="2.5" className="stroke-foreground/10" />
				{fill !== null && (
					<circle
						cx="16"
						cy="16"
						r={RING_RADIUS}
						fill="none"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeDasharray={RING_LENGTH}
						strokeDashoffset={(1 - Math.max(0.02, fill)) * RING_LENGTH}
						className={cn("transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none", TONE_CLASS[tone].ring)}
					/>
				)}
			</svg>
			{children}
		</span>
	);
}

interface GaugeTileProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
	/** A button, which opens a card; otherwise a focusable picture, which a tooltip explains. */
	as: "button" | "img";
	/** What a screen reader says for the tile. */
	label: string;
	/** Fraction the ring fills, 0 to 1; `null` leaves it empty. */
	fill: number | null;
	tone: Tone;
	/** What sits in the ring, such as a provider's logo. */
	icon: ReactNode;
	/** The figure under the ring, in the tile's tone; `null` shows a dash. */
	value: string | null;
	/** The muted line under the figure, which wraps to a second line, as a long email does. */
	caption: string;
	ref?: Ref<HTMLElement>;
}

/** One tile of the foot's grid: a ring, its figure, and its caption, stacked; it takes a popover's or a tooltip's trigger props. */
export function GaugeTile({ as, label, fill, tone, icon, value, caption, ref, ...props }: GaugeTileProps) {
	const body = (
		<>
			<GaugeRing fill={fill} tone={tone}>
				{icon}
			</GaugeRing>
			<span className={cn("max-w-full truncate font-medium", TONE_CLASS[tone].text)}>{value ?? "—"}</span>
			<span className="line-clamp-2 max-w-full text-center text-3xs text-muted-foreground [overflow-wrap:anywhere]">{caption}</span>
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

/** One cell of the foot's grid, holding a {@link GaugeTile} and stretching it to the row's height. */
export function GaugeCell({ children }: { children: ReactNode }) {
	return <li className="flex min-w-0 flex-col">{children}</li>;
}
