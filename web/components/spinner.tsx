/** The infinity spinner, which a Button also draws while `loading`, cropped to its width so it sits beside a label as an icon would. */
import type { IconComponentProps } from "@/lib/icon-context";
import { cn } from "@/lib/utils";

/** The infinity glyph on a 24-unit box, which `ThinkingIndicator` also morphs into. */
export const GLYPH = "M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z";

/**
 * Work in progress, sized by `className` or `size` as a Lucide icon is, so a Button takes it as its `leadingIcon`.
 * A faint copy of the glyph lies under the running stroke, so the shape reads at icon sizes where the stroke alone is a tick.
 * With reduced motion the whole glyph pulses instead of a stroke running round it.
 */
export function Spinner({ size, strokeWidth = 1.5, className }: IconComponentProps) {
	return (
		<svg aria-hidden width={size} height={size} viewBox="4 4 16 16" fill="none" className={cn("shrink-0", className)}>
			<path d={GLYPH} stroke="currentColor" strokeWidth={strokeWidth} strokeOpacity={0.25} />
			<path
				d={GLYPH}
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				pathLength="100"
				className="motion-safe:animate-[spinner-move_2s_linear_infinite,spinner-dash_4s_ease-in-out_infinite] motion-safe:[stroke-dasharray:15_85] motion-reduce:animate-[bot-pulse_1.6s_ease-in-out_infinite]"
			/>
		</svg>
	);
}
