import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { type Theme, THEMES, useTheme } from "../../theme";
import { Section } from "./editor";

const THEME_OPTIONS: Record<Theme, [string, LucideIcon]> = {
	system: ["System", Monitor],
	light: ["Light", Sun],
	dark: ["Dark", Moon],
};

/** The dashboard's own look, kept in this browser rather than in omp's files. */
export function AppearanceTab() {
	const [theme, setTheme] = useTheme();
	return (
		<Section title="Theme" meta="System follows your computer's light or dark setting. Saved in this browser.">
			<RadioGroup
				aria-label="Theme"
				value={theme}
				onValueChange={value => setTheme(THEMES.find(option => option === value) ?? theme)}
				className="flex gap-2"
			>
				{THEMES.map(option => {
					const [label, Icon] = THEME_OPTIONS[option];
					return (
						<Radio.Root
							key={option}
							value={option}
							className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md pr-3 pl-2 text-[12px] text-muted-foreground shadow-[0_0_0_1px_var(--border)] outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-active data-[checked]:text-foreground"
						>
							<Icon aria-hidden className="size-3.5" />
							{label}
						</Radio.Root>
					);
				})}
			</RadioGroup>
		</Section>
	);
}
