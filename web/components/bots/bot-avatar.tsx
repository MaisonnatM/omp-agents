/** `BotAvatar`, a Bot's face: a colored shape with two eyes, picked from its id, that looks around while the Bot works. */
import type { CSSProperties, ReactNode } from "react";
import type { BotId } from "../../../src/shared/bots";
import { cn } from "@/lib/utils";
import { type BotShape, botLook } from "../../bots-model";

const SIZE = { header: "size-6", row: "size-9", sheet: "size-10", hero: "size-16" } as const;

/** Each shape's body in a 32-unit box, and the height its eyes sit at. A stroke the body's own color rounds a polygon's corners. */
const BODY: Record<BotShape, { eyes: number; body: ReactNode }> = {
	circle: { eyes: 14, body: <circle cx={16} cy={16} r={14.5} /> },
	square: { eyes: 14, body: <rect x={2.5} y={2.5} width={27} height={27} rx={8} /> },
	triangle: { eyes: 19, body: <path d="M16 5 28 26.5H4Z" strokeWidth={4} strokeLinejoin="round" /> },
	hexagon: { eyes: 15, body: <path d="M16 4 26.5 10v12L16 28 5.5 22V10Z" strokeWidth={3} strokeLinejoin="round" /> },
	diamond: { eyes: 15, body: <path d="M16 4 28 16 16 28 4 16Z" strokeWidth={3.5} strokeLinejoin="round" /> },
	cloud: {
		eyes: 17,
		body: (
			<>
				<circle cx={11} cy={18} r={7.5} />
				<circle cx={18} cy={12.5} r={8} />
				<circle cx={23.5} cy={18.5} r={6.5} />
				<rect x={5} y={17} width={22} height={9.5} rx={4.75} />
			</>
		),
	},
	clover: {
		eyes: 15,
		body: (
			<>
				<circle cx={16} cy={9.5} r={6.5} />
				<circle cx={22.5} cy={16} r={6.5} />
				<circle cx={16} cy={22.5} r={6.5} />
				<circle cx={9.5} cy={16} r={6.5} />
				<circle cx={16} cy={16} r={7} />
			</>
		),
	},
	pill: { eyes: 15, body: <rect x={2} y={7.5} width={28} height={17} rx={8.5} /> },
};

interface BotAvatarProps {
	id: BotId;
	size: keyof typeof SIZE;
	/** The Bot is working: it bobs and glances, or with reduced motion its eyes pulse. */
	working?: boolean;
	/** It waits on your answer: an amber mark on its corner. */
	asking?: boolean;
	className?: string;
}

export function BotAvatar({ id, size, working = false, asking = false, className }: BotAvatarProps) {
	const { shape, hue } = botLook(id);
	const { eyes, body } = BODY[shape];
	return (
		<span aria-hidden className={cn("relative inline-flex shrink-0", SIZE[size], className)} style={{ "--bot-hue": hue } as CSSProperties}>
			<svg
				viewBox="0 0 32 32"
				className={cn(
					"size-full overflow-visible text-[oklch(0.8_0.12_var(--bot-hue))] dark:text-[oklch(0.74_0.12_var(--bot-hue))]",
					working && "motion-safe:animate-[bot-bob_1.6s_ease-in-out_infinite]",
				)}
			>
				<g fill="currentColor" stroke="currentColor" strokeWidth={0}>
					{body}
				</g>
				<g
					className={cn(
						"fill-[oklch(0.27_0.05_var(--bot-hue))]",
						working && "motion-safe:animate-[bot-glance_2.4s_ease-in-out_infinite] motion-reduce:animate-[bot-pulse_1.6s_ease-in-out_infinite]",
					)}
				>
					<rect x={10.6} y={eyes - 3} width={3.2} height={6} rx={1.6} transform={`rotate(10 12.2 ${eyes})`} />
					<rect x={18.2} y={eyes - 3} width={3.2} height={6} rx={1.6} transform={`rotate(10 19.8 ${eyes})`} />
				</g>
			</svg>
			{asking && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background" />}
		</span>
	);
}
