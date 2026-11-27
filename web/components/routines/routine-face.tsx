/** `RoutineFace`, a routine's picture in the Board's style the retired Bots had: a colored shape with two eyes, its shape and hue picked from the routine's id. */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Each shape's body in a 32-unit box, and the height its eyes sit at. A stroke the body's own color rounds a polygon's corners. */
const SHAPES: readonly { eyes: number; body: ReactNode }[] = [
	{ eyes: 14, body: <circle cx={16} cy={16} r={14.5} /> },
	{ eyes: 14, body: <rect x={2.5} y={2.5} width={27} height={27} rx={8} /> },
	{ eyes: 19, body: <path d="M16 5 28 26.5H4Z" strokeWidth={4} strokeLinejoin="round" /> },
	{ eyes: 15, body: <path d="M16 4 26.5 10v12L16 28 5.5 22V10Z" strokeWidth={3} strokeLinejoin="round" /> },
	{ eyes: 15, body: <path d="M16 4 28 16 16 28 4 16Z" strokeWidth={3.5} strokeLinejoin="round" /> },
	{
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
	{
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
	{ eyes: 15, body: <rect x={2} y={7.5} width={28} height={17} rx={8.5} /> },
];

const HUES = [25, 70, 110, 150, 195, 235, 275, 320] as const;

/** FNV-1a over the id, so a routine keeps its face on every screen and across restarts. */
function hashOf(id: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
	return hash >>> 0;
}

export function RoutineFace({ id, className }: { id: string; className?: string }) {
	const hash = hashOf(id);
	const { eyes, body } = SHAPES[hash % SHAPES.length]!;
	const hue = HUES[(hash >>> 8) % HUES.length]!;
	return (
		<span aria-hidden className={cn("inline-flex shrink-0", className)} style={{ "--routine-hue": hue } as CSSProperties}>
			<svg viewBox="0 0 32 32" className="size-full overflow-visible text-[oklch(0.8_0.12_var(--routine-hue))] dark:text-[oklch(0.74_0.12_var(--routine-hue))]">
				<g fill="currentColor" stroke="currentColor" strokeWidth={0}>
					{body}
				</g>
				<g className="fill-[oklch(0.27_0.05_var(--routine-hue))]">
					<rect x={10.6} y={eyes - 3} width={3.2} height={6} rx={1.6} transform={`rotate(10 12.2 ${eyes})`} />
					<rect x={18.2} y={eyes - 3} width={3.2} height={6} rx={1.6} transform={`rotate(10 19.8 ${eyes})`} />
				</g>
			</svg>
		</span>
	);
}
