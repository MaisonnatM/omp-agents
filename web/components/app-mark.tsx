import { useId } from "react";

/** omp's mark, the gradient glyph of `web/favicon.svg`, cropped to the glyph so its box is the glyph's size. */
export function AppMark({ className }: { className?: string }) {
	const gradient = useId();
	return (
		<svg viewBox="8 12 48 46" aria-hidden="true" className={className}>
			<defs>
				<linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="oklch(0.7 0.24 340)" />
					<stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
					<stop offset="1" stopColor="oklch(0.81 0.14 200)" />
				</linearGradient>
			</defs>
			<path fill={`url(#${gradient})`} d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
		</svg>
	);
}
