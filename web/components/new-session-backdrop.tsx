import { useState } from "react";
import { Aurora } from "@/components/dithercn/aurora";
import { BlackHole } from "@/components/dithercn/black-hole";
import { DitherGlobe } from "@/components/dithercn/dither-globe";
import { Eclipse } from "@/components/dithercn/eclipse";
import { Fire } from "@/components/dithercn/fire";
import { Galaxy } from "@/components/dithercn/galaxy";
import { Horizon } from "@/components/dithercn/horizon";
import { RetroGrid } from "@/components/dithercn/retro-grid";

const BACKDROPS = {
	"retro-grid": { label: "Retro grid", draw: (className: string) => <RetroGrid aria-hidden horizon={0.62} sun={0.42} className={className} /> },
	aurora: { label: "Aurora", draw: (className: string) => <Aurora className={className} /> },
	fire: { label: "Fire", draw: (className: string) => <Fire className={className} /> },
	eclipse: { label: "Eclipse", draw: (className: string) => <Eclipse className={className} /> },
	"black-hole": { label: "Black hole", draw: (className: string) => <BlackHole className={className} /> },
	horizon: { label: "Horizon", draw: (className: string) => <Horizon className={className} /> },
	galaxy: { label: "Galaxy", draw: (className: string) => <Galaxy className={className} /> },
	globe: { label: "Globe", draw: (className: string) => <DitherGlobe className={className} /> },
} as const;

type BackdropName = keyof typeof BACKDROPS;

const STORAGE_KEY = "omp-agents.new-session-backdrop";

const isBackdrop = (value: string | null): value is BackdropName => value !== null && Object.hasOwn(BACKDROPS, value);

const readBackdrop = (): BackdropName => {
	const stored = localStorage.getItem(STORAGE_KEY);
	return isBackdrop(stored) ? stored : "retro-grid";
};

// It fills the page's lower part and fades out under the title.
const BACKDROP_BOX = "pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[40%] opacity-70 [mask-image:linear-gradient(to_bottom,transparent,black_35%)]";

/** The new session page's dither backdrop, and the header select that picks it; the pick persists in this browser. */
export function useNewSessionBackdrop(pillClassName: string) {
	const [name, setName] = useState(readBackdrop);
	const backdrop = <div aria-hidden>{BACKDROPS[name].draw(BACKDROP_BOX)}</div>;
	const picker = (
		<select
			aria-label="Background"
			value={name}
			onChange={event => {
				if (!isBackdrop(event.target.value)) return;
				localStorage.setItem(STORAGE_KEY, event.target.value);
				setName(event.target.value);
			}}
			className={pillClassName}
		>
			{Object.entries(BACKDROPS).map(([value, { label }]) => (
				<option key={value} value={value}>
					{label}
				</option>
			))}
		</select>
	);
	return { backdrop, picker };
}
