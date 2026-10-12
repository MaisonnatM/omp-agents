/** `PreferencesTab`: the dashboard's own choices kept in this browser, such as sidebar tabs and the session skill. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Switch } from "@base-ui/react/switch";
import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { type ComponentProps, useContext } from "react";
import { MCP_SERVICES } from "../../../src/shared/accounts";
import { usePinnedSkill } from "../../pinned-skill";
import { type ShortcutId, shortcutKeys } from "../../shortcuts";
import { hideTab, moveTab, positionKey, TAB_ROWS, useSidebarTabs } from "../../sidebar-tabs";
import { type Theme, THEMES, useTheme } from "../../theme";
import { useSkills } from "../../use-skills";
import { SkillPicker } from "../skill-picker";
import { ActivityVisibility } from "../transcript";
import { OrderButton, Section } from "./editor";

const THEME_OPTIONS: Record<Theme, [string, LucideIcon]> = {
	system: ["System", Monitor],
	light: ["Light", Sun],
	dark: ["Dark", Moon],
};

function PreferenceSwitch(props: Omit<ComponentProps<typeof Switch.Root>, "className" | "children">) {
	return (
		<Switch.Root
			{...props}
			className="inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 motion-reduce:transition-none"
		>
			<Switch.Thumb className="size-3 rounded-full bg-background shadow-xs transition-transform data-[checked]:translate-x-3 motion-reduce:transition-none" />
		</Switch.Root>
	);
}

function ActivitySwitch({ label, shortcut, checked, onToggle }: { label: string; shortcut: ShortcutId; checked: boolean; onToggle: () => void }) {
	return (
		<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
			<PreferenceSwitch checked={checked} onCheckedChange={onToggle} />
			{label}
			<span className="text-muted-foreground">{shortcutKeys(shortcut)}</span>
		</label>
	);
}

const PINNED_SHOWS = "Always shows, so you can show the other tabs again.";

/** The sidebar's tabs in the order the bar shows them, each with the key it takes now, a switch to hide it, and buttons to move it. */
function SidebarTabs() {
	const { layout, setLayout, signedOut, shown } = useSidebarTabs();
	return (
		<Section
			title="Sidebar tabs"
			meta={`The tabs the sidebar shows, in order, and ${shortcutKeys("tab1")} goes to the first one shown. A hidden tab's page, command, and links still work. Saved in this browser.`}
		>
			<ol className="space-y-1 text-sm">
				{layout.map(({ tab, hidden }, index) => {
					const row = TAB_ROWS[tab];
					const position = positionKey(tab, shown);
					return (
						<li key={tab} className="flex items-center gap-2">
							<row.icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								{row.label}
								{"integration" in row && signedOut.has(tab) && (
									<p className="text-xs text-muted-foreground">Shows only while {MCP_SERVICES[row.integration].label} is connected.</p>
								)}
								{"pinned" in row && <p className="text-xs text-muted-foreground">{PINNED_SHOWS}</p>}
							</div>
							<span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{position === undefined ? null : shortcutKeys(position)}</span>
							<PreferenceSwitch
								checked={!hidden}
								disabled={"pinned" in row}
								onCheckedChange={checked => setLayout(prev => hideTab(prev, tab, !checked))}
								aria-label={`Show ${row.label}`}
							/>
							<OrderButton label={row.label} direction="up" disabled={index === 0} onClick={() => setLayout(prev => moveTab(prev, tab, -1))} />
							<OrderButton label={row.label} direction="down" disabled={index === layout.length - 1} onClick={() => setLayout(prev => moveTab(prev, tab, 1))} />
						</li>
					);
				})}
			</ol>
		</Section>
	);
}

/**
 * The skill every session the dashboard starts goes through. It lists the skills of `cwd`, the workspace the settings
 * were opened on, else the user's own.
 */
function PinnedSkill({ cwd, workspace }: { cwd: string | null; workspace: string | null }) {
	const [pinned, pin] = usePinnedSkill();
	const skills = useSkills(cwd ?? "~");
	const listed = workspace === null ? "Lists your own skills." : `Lists the skills of ${workspace}.`;
	return (
		<Section
			title="New sessions"
			meta={`The first message of every session you start here, a quick action's included, goes through the pinned skill. Saved in this browser. ${listed}`}
		>
			<SkillPicker label="Pinned skill" skills={skills} value={pinned} onPick={pin} />
			{pinned !== null && skills.error === null && skills.data && !skills.data.skills.some(skill => skill.name === pinned) && (
				<p className="text-xs text-muted-foreground">No skill named {pinned} here. A session in a directory without it starts without it.</p>
			)}
		</Section>
	);
}

/** The dashboard's own choices, kept in this browser rather than in omp's files. `workspace` names `cwd` for the skill list. */
export function PreferencesTab({ cwd, workspace }: { cwd: string | null; workspace: string | null }) {
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
			<SidebarTabs />
			<PinnedSkill cwd={cwd} workspace={workspace} />
		</>
	);
}
