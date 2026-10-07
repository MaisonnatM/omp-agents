import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Switch } from "@base-ui/react/switch";
import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useContext } from "react";
import { type ShortcutId, shortcutKeys } from "../../shortcuts";
import { type Theme, THEMES, useTheme } from "../../theme";
import { ActivityVisibility } from "../transcript";
import { Section } from "./editor";

const THEME_OPTIONS: Record<Theme, [string, LucideIcon]> = {
	system: ["System", Monitor],
	light: ["Light", Sun],
	dark: ["Dark", Moon],
};

function ActivitySwitch({ label, shortcut, checked, onToggle }: { label: string; shortcut: ShortcutId; checked: boolean; onToggle: () => void }) {
	return (
		<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
			<Switch.Root
				checked={checked}
				onCheckedChange={onToggle}
				className="inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary motion-reduce:transition-none"
			>
				<Switch.Thumb className="size-3 rounded-full bg-background shadow-xs transition-transform data-[checked]:translate-x-3 motion-reduce:transition-none" />
			</Switch.Root>
			{label}
			<span className="text-muted-foreground">{shortcutKeys(shortcut)}</span>
		</label>
	);
}

/** The dashboard's own look, kept in this browser rather than in omp's files. */
export function AppearanceTab() {
	const [theme, setTheme] = useTheme();
	const { hideTools, hideThinking, toggleTools, toggleThinking } = useContext(ActivityVisibility);
	return (
		<>
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
			<Section title="Transcript" meta="What each activity group shows under its heading, in every pane. Saved in this browser.">
				<div className="space-y-2">
					<ActivitySwitch label="Show tool calls" shortcut="hideTools" checked={!hideTools} onToggle={toggleTools} />
					<ActivitySwitch label="Show thinking" shortcut="hideThinking" checked={!hideThinking} onToggle={toggleThinking} />
				</div>
			</Section>
		</>
	);
}
