import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface StepperStep {
	/** Stable key, so each step keeps its own motion when the list changes. */
	id: string;
	label: string;
	/** A short hint under the label. */
	description?: string;
}

interface StepperProps {
	steps: StepperStep[];
	/** Index of the step in progress. `steps.length` marks the whole flow complete. */
	current: number;
	/** Accessible name for the stepper. */
	label: string;
	/** Announced once every step is complete. */
	completeLabel: string;
	className?: string;
}

type Status = "complete" | "current" | "upcoming";

const DURATION = { fast: 0.16, standard: 0.24 };
const EASE = { enter: [0.16, 1, 0.3, 1], standard: [0.22, 1, 0.36, 1] } as const;
const SNAPPY = { type: "spring", visualDuration: 0.26, bounce: 0 } as const;
const SMOOTH = { type: "spring", visualDuration: 0.4, bounce: 0 } as const;
const STAGGER = 0.08;

const blur = (radius: number) => `blur(${radius}px)`;
const still = { duration: 0 } as const;
const leave = { duration: DURATION.fast, ease: EASE.standard } as const;
const settle = { duration: DURATION.standard, ease: EASE.enter } as const;
const textFrom = { opacity: 0, y: "0.3em", filter: blur(4) };
const textRest = { opacity: 1, y: 0, filter: blur(0) };
const textGone = { opacity: 0, y: "-0.3em", filter: blur(2) };
const glyphFrom = { opacity: 0, scale: 0.5, filter: blur(2) };
const glyphRest = { opacity: 1, scale: 1, filter: blur(0) };

/** Text that rises in with a small blur when it changes; its slot springs to the new height, so the steps below ease down instead of jumping. */
function SwapText({ text, reduced }: { text?: string; reduced: boolean }) {
	const inner = useRef<HTMLSpanElement>(null);
	const armedUntil = useRef(0);
	const height = useMotionValue<number | "auto">("auto");
	useLayoutEffect(() => {
		armedUntil.current = performance.now() + 700;
	}, [text]);
	useEffect(() => {
		const node = inner.current;
		if (!node) return;
		let measured = false;
		const observer = new ResizeObserver(() => {
			const next = node.offsetHeight;
			if (!measured || reduced || performance.now() > armedUntil.current) {
				measured = true;
				height.jump(next);
				return;
			}
			animate(height, next, SMOOTH);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [height, reduced]);
	return (
		<motion.span className="block" style={{ height }}>
			<span ref={inner} className="relative block">
				<AnimatePresence mode="popLayout" initial={false}>
					{text ? (
						<motion.span
							key={text}
							className="block pt-0.5 text-xs text-muted-foreground [overflow-wrap:break-word]"
							initial={textFrom}
							animate={textRest}
							exit={{ ...textGone, transition: reduced ? still : leave }}
							transition={reduced ? still : settle}
						>
							{text}
						</motion.span>
					) : null}
				</AnimatePresence>
			</span>
		</motion.span>
	);
}

/** The number and the check share one spot: the outgoing glyph shrinks away while the next one pops in and draws its stroke. */
function Glyph({ check, number, delay, reduced }: { check: boolean; number: number; delay: number; reduced: boolean }) {
	const pop = reduced ? still : { scale: { ...SNAPPY, delay }, opacity: { duration: DURATION.fast, delay }, filter: { duration: DURATION.fast, delay } };
	const exit = { ...glyphFrom, transition: reduced ? still : leave };
	if (!check)
		return (
			<motion.span className="col-start-1 row-start-1 grid place-items-center" initial={glyphFrom} animate={glyphRest} exit={exit} transition={pop}>
				{number}
			</motion.span>
		);
	return (
		<motion.svg
			className="col-start-1 row-start-1 size-3"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			initial={glyphFrom}
			animate={glyphRest}
			exit={exit}
			transition={pop}
		>
			<motion.path
				d="M5.5 12.5l4.25 4.25L18.5 8"
				initial={{ pathLength: 0 }}
				animate={{ pathLength: 1 }}
				transition={reduced ? still : { duration: DURATION.standard, ease: EASE.enter, delay: delay + 0.04 }}
			/>
		</motion.svg>
	);
}

const DISC: Record<Status, string> = {
	complete: "bg-emerald-500 text-white shadow-[inset_0_0_0_1px_var(--color-emerald-500)]",
	current: "bg-popover text-foreground shadow-[inset_0_0_0_1.5px_var(--color-emerald-500)]",
	upcoming: "bg-popover text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]",
};

const LABEL: Record<Status, string> = { complete: "text-muted-foreground", current: "text-foreground", upcoming: "text-muted-foreground/70" };

const STATUS_TEXT: Record<Status, string> = { complete: "Completed", current: "", upcoming: "Not started" };

/** Arc's vertical, read-only Stepper: a marker per step on a rail whose fill springs from step to step, with a ring around the current one. */
export function Stepper({ steps, current, label, completeLabel, className }: StepperProps) {
	const reduced = useReducedMotion() ?? false;
	const count = steps.length;
	const active = Math.min(Math.max(Math.round(current), 0), count);
	// Where progress came from, so a jump across several steps fills or drains its connectors one after another.
	const [travel, setTravel] = useState({ to: active, from: active });
	if (travel.to !== active) setTravel({ to: active, from: travel.to });
	const from = travel.from;
	const delayAt = (index: number) => {
		if (reduced) return 0;
		if (active > from) return index >= from && index < active ? (index - from) * STAGGER : 0;
		return index >= active && index < from ? (from - 1 - index) * STAGGER : 0;
	};
	const ringDelay = reduced ? 0 : Math.max(0, Math.abs(active - from) - 1) * STAGGER + 0.12;
	const now = active >= count ? undefined : steps[active];
	return (
		<div role="group" aria-label={label} className={cn("min-w-0", className)}>
			<ol className="grid">
				{steps.map((step, index) => {
					const isCurrent = index === active;
					const status: Status = index < active ? "complete" : isCurrent ? "current" : "upcoming";
					return (
						<li key={step.id} className="relative min-w-0 [&:not(:last-child)]:pb-4">
							{index < count - 1 ? (
								<span aria-hidden className="pointer-events-none absolute top-[calc(1.25rem+5px)] bottom-[5px] left-[calc(0.625rem-1px)] w-0.5 overflow-hidden rounded-full bg-border">
									<motion.span
										className="absolute inset-0 origin-top rounded-full bg-emerald-500"
										initial={false}
										animate={{ scaleY: index < active ? 1 : 0 }}
										transition={reduced ? still : { ...SMOOTH, delay: delayAt(index) }}
									/>
								</span>
							) : null}
							<span className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3" aria-current={isCurrent ? "step" : undefined}>
								<span aria-hidden className="relative grid size-5 place-items-center">
									<AnimatePresence initial={false}>
										{isCurrent ? (
											<motion.span
												key="ring"
												className="absolute -inset-[3px] rounded-full bg-emerald-500/15"
												initial={{ opacity: 0, scale: 0.6 }}
												animate={{ opacity: 1, scale: 1 }}
												exit={{ opacity: 0, scale: 0.6, transition: reduced ? still : leave }}
												transition={reduced ? still : { scale: { ...SNAPPY, delay: ringDelay }, opacity: { duration: DURATION.fast, delay: ringDelay } }}
											/>
										) : null}
									</AnimatePresence>
									<span className={cn("relative grid size-full place-items-center rounded-full text-[10px] font-medium tabular-nums leading-none transition-[background-color,box-shadow,color] duration-200 motion-reduce:transition-none", DISC[status])}>
										<AnimatePresence initial={false}>
											<Glyph key={status === "complete" ? "check" : "number"} check={status === "complete"} number={index + 1} delay={delayAt(index)} reduced={reduced} />
										</AnimatePresence>
									</span>
								</span>
								<span className="grid min-w-0">
									<span className={cn("block text-sm font-medium leading-5 [overflow-wrap:break-word] transition-colors duration-200 motion-reduce:transition-none", LABEL[status])}>{step.label}</span>
									{STATUS_TEXT[status] ? <span className="sr-only">, {STATUS_TEXT[status]}</span> : null}
									<SwapText text={isCurrent ? step.description : undefined} reduced={reduced} />
								</span>
							</span>
						</li>
					);
				})}
			</ol>
			<span className="sr-only" aria-live="polite">
				{now ? `Step ${active + 1} of ${count}: ${now.label}` : completeLabel}
			</span>
		</div>
	);
}
