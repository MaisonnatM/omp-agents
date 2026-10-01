import type { ContextUsage } from "../../src/shared";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** From these fractions of the window used, the ring turns amber, then red. */
const FILLING = 0.7;
const NEARLY_FULL = 0.9;

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const tokens = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** How full the session's context window is, as a ring that fills clockwise. Hover or focus it for the numbers. */
export function ContextRing({ context }: { context: ContextUsage }) {
	const used = Math.min(context.tokens / context.window, 1);
	const percent = Math.round(used * 100);
	const label = `Context ${percent}% full: ${tokens.format(context.tokens)} of ${tokens.format(context.window)} tokens`;
	return (
		<Tooltip content={label}>
			<span
				role="meter"
				aria-label="Context used"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-valuetext={label}
				tabIndex={0}
				className={cn(
					"inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
					used >= NEARLY_FULL
						? "text-red-600 dark:text-red-400"
						: used >= FILLING
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground",
				)}
			>
				<svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden="true">
					<circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
					<circle
						cx="9"
						cy="9"
						r={RADIUS}
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						strokeDasharray={CIRCUMFERENCE}
						strokeDashoffset={CIRCUMFERENCE * (1 - used)}
						className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
					/>
				</svg>
			</span>
		</Tooltip>
	);
}
