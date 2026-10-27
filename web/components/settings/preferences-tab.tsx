import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { ToggleSwitch } from "../toggle-switch";
import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useContext } from "react";
import { MCP_SERVICES } from "../../../src/shared/accounts";
import { usePinnedSkill } from "../../pinned-skill";
import { type ShortcutId, shortcutKeys } from "../../shortcuts";
import { TAB_GROUPS } from "../../routing";
import { groupTabs, hideTab, moveTab, positionKey, TAB_ROWS, useSidebarTabs } from "../../sidebar-tabs";
import { type Theme, THEMES, useTheme } from "../../theme";
import { playSound, useSessionNotifications } from "../../use-attention";
import { useSkills } from "../../use-skills";
import { SkillPicker } from "../skill-picker";
import { ActivityVisibility } from "../transcript";
import { OrderButton, Section } from "./editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { putJson } from "../../api";
import { useEditableRead } from "../../editable-read";
import { type ProcessSettings, STOP_IDLE_CHOICES } from "../../../src/shared/processes";
import { NOTIFICATION_SOUNDS, type NotificationSound } from "../../../src/shared/desktop-bridge";

const THEME_OPTIONS: Record<Theme, [string, LucideIcon]> = {
	system: ["System", Monitor],
	light: ["Light", Sun],
	dark: ["Dark", Moon],
};

function ActivitySwitch({ label, shortcut, checked, onToggle }: { label: string; shortcut: ShortcutId; checked: boolean; onToggle: () => void }) {
	return (
		<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
			<ToggleSwitch checked={checked} onCheckedChange={onToggle} />
			{label}
			<span className="text-muted-foreground">{shortcutKeys(shortcut)}</span>
		</label>
	);
}

/** The sidebar's tabs in the order the bar shows them, each with the key it takes now, a switch to hide it, and buttons to move it. */
function SidebarTabs() {
	const { layout, setLayout, signedOut, shown } = useSidebarTabs();
	return (
		<Section
			title="Sidebar tabs"
			meta={`The tabs the sidebar shows, in order. The header's Dev and Ops switch picks which group's tabs the bar draws, and ${shortcutKeys("tab1")} goes to the first one it draws. A hidden tab's page, command, and links still work. Saved in this app.`}
		>
			<ol className="space-y-1 text-sm">
				{layout.map(({ tab, hidden }, index) => {
					const row = TAB_ROWS[tab];
					const position = positionKey(tab, groupTabs(shown, row.group));
					return (
						<li key={tab} className="flex items-center gap-2">
							<row.icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								{row.label}
								<span className="ml-1.5 text-xs text-muted-foreground">{TAB_GROUPS.find(({ value }) => value === row.group)?.label}</span>
								{"integration" in row && signedOut.has(tab) && (
									<p className="text-xs text-muted-foreground">Shows only while {MCP_SERVICES[row.integration].label} is connected.</p>
								)}
							</div>
							<span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{position === undefined ? null : shortcutKeys(position)}</span>
							<ToggleSwitch
								checked={!hidden}
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
			meta={`The first message of every session you start here, a quick action's included, goes through the pinned skill. Saved in this app. ${listed}`}
		>
			<SkillPicker label="Pinned skill" skills={skills} value={pinned} onPick={pin} />
			{pinned !== null && skills.error === null && skills.data && !skills.data.skills.some(skill => skill.name === pinned) && (
				<p className="text-xs text-muted-foreground">No skill named {pinned} here. A session in a directory without it starts without it.</p>
			)}
		</Section>
	);
}

const SOUND_ITEMS = NOTIFICATION_SOUNDS.map(value => ({ value, label: value === "off" ? "None" : value === "default" ? "System default" : value }));

/** The system notifications of sessions that ask you something or end a turn, while the window is not focused, and the sound they play. */
function SessionNotifications() {
	const { on, setOn, turns, setTurns, sound, setSound, soundWhenFocused, setSoundWhenFocused } = useSessionNotifications();
	const chooseSound = (next: NotificationSound): void => {
		setSound(next);
		playSound(next);
	};
	return (
		<Section
			title="Notifications"
			meta="In the desktop app, a system notification when a session asks you something or finishes a turn while this window is not focused; clicking it opens the session. Picking a sound plays it. Saved in this app."
		>
			<div className="space-y-2">
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
					<ToggleSwitch checked={on} onCheckedChange={setOn} />
					Notify me when a session needs me
				</label>
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground">
					<ToggleSwitch checked={turns} onCheckedChange={setTurns} disabled={!on} />
					Also when a session finishes a turn
				</label>
				<div className="flex items-center gap-2 text-[12px]">
					<span className={on ? undefined : "text-muted-foreground"}>Sound</span>
					<Select<NotificationSound> items={SOUND_ITEMS} value={sound} onValueChange={next => next && chooseSound(next)} disabled={!on}>
						<SelectTrigger aria-label="Notification sound" className="w-fit">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SOUND_ITEMS.map(({ value, label }) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground">
					<ToggleSwitch checked={soundWhenFocused} onCheckedChange={setSoundWhenFocused} disabled={!on || sound === "off"} />
					Play the sound while this window is focused too
				</label>
			</div>
		</Section>
	);
}

type IdleChoice = "off" | "15" | "30" | "60" | "120";
const IDLE_CHOICES: Record<IdleChoice, string> = { off: "Off", "15": "After 15 minutes", "30": "After 30 minutes", "60": "After 1 hour", "120": "After 2 hours" };

/** When the server stops what sessions run besides omp: once every session a process serves has been idle that long. */
function IdleProcessStop() {
	const read = useEditableRead<ProcessSettings>("/api/process-settings");
	const minutes = read.data?.stopIdleAfterMinutes;
	const choose = (choice: IdleChoice): void => {
		const next: ProcessSettings = { stopIdleAfterMinutes: STOP_IDLE_CHOICES.find(each => String(each ?? "off") === choice) ?? null };
		read.edit(next, () => putJson<ProcessSettings>("/api/process-settings", next));
	};
	return (
		<Section
			title="Stop idle processes"
			meta="Dev servers, watchers, and services a session starts besides omp. A process stops once every session it serves has been idle that long; hover the CPU in the status bar to see when. Saved on the server."
		>
			{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
			{minutes !== undefined && (
				<Select<IdleChoice> items={IDLE_CHOICES} value={minutes === null ? "off" : (String(minutes) as IdleChoice)} onValueChange={next => next && choose(next)}>
					<SelectTrigger aria-label="Stop idle processes" className="w-fit">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(Object.keys(IDLE_CHOICES) as IdleChoice[]).map(choice => (
							<SelectItem key={choice} value={choice}>
								{IDLE_CHOICES[choice]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{read.saveError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{`Not saved: ${read.saveError}`}</p>}
		</Section>
	);
}

/** The dashboard's own choices, most kept in this app rather than in omp's files. `workspace` names `cwd` for the skill list. */
export function PreferencesTab({ cwd, workspace }: { cwd: string | null; workspace: string | null }) {
	const [theme, setTheme] = useTheme();
	const { hideTools, hideThinking, toggleTools, toggleThinking } = useContext(ActivityVisibility);
	return (
		<>
			<Section title="Theme" meta="System follows your computer's light or dark setting. Saved in this app.">
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
			<Section title="Transcript" meta="What each activity group shows under its heading, in every pane. Saved in this app.">
				<div className="space-y-2">
					<ActivitySwitch label="Show tool calls" shortcut="hideTools" checked={!hideTools} onToggle={toggleTools} />
					<ActivitySwitch label="Show thinking" shortcut="hideThinking" checked={!hideThinking} onToggle={toggleThinking} />
				</div>
			</Section>
			<SidebarTabs />
			<SessionNotifications />
			<IdleProcessStop />
			<PinnedSkill cwd={cwd} workspace={workspace} />
		</>
	);
}
