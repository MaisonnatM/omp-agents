import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { ToggleSwitch } from "../toggle-switch";
import { IconImac, IconMoon, IconSun } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { useContext, useState } from "react";
import { usePinnedSkill } from "../../pinned-skill";
import { type ShortcutId, shortcutKeys } from "../../shortcuts";
import { hideTab, moveTab, ROWLESS_TABS, TAB_ROWS, useSidebarTabs } from "../../sidebar-tabs";
import { type Theme, THEMES, useTheme } from "../../theme";
import { playSound, useSessionNotifications } from "../../use-attention";
import { useSkills } from "../../use-skills";
import { ShownOrderList } from "../shown-order-list";
import { SkillPicker } from "../skill-picker";
import { ActivityVisibility } from "../transcript";
import { LINK, Section } from "./editor";
import { isWebModuleId } from "../../modules";
import { useModulesOff } from "../../modules-off";
import { hashForSettings } from "../../routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { putJson } from "../../api";
import { useEditableRead } from "../../editable-read";
import { type ProcessSettings, STOP_IDLE_CHOICES, STOP_IDLE_SESSION_CHOICES } from "../../../src/shared/processes";
import { NOTIFICATION_SOUNDS, type NotificationSound } from "../../../src/shared/desktop-bridge";

const THEME_OPTIONS: Record<Theme, [string, IconComponent]> = {
	system: ["System", IconImac],
	light: ["Light", IconSun],
	dark: ["Dark", IconMoon],
};

function ActivitySwitch({ label, shortcut, checked, onToggle }: { label: string; shortcut?: ShortcutId; checked: boolean; onToggle: () => void }) {
	return (
		<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
			<ToggleSwitch checked={checked} onCheckedChange={onToggle} />
			{label}
			{shortcut && <span className="text-muted-foreground">{shortcutKeys(shortcut)}</span>}
		</label>
	);
}

/** The sidebar's tabs in the order they show, each with a switch to hide it and buttons to move it. */
function SidebarTabs() {
	const { layout, setLayout } = useSidebarTabs();
	const [off] = useModulesOff();
	return (
		<Section
			title="Sidebar tabs"
			meta="The pages the sidebar lists, in order. A hidden tab's page, command, and links still work. Saved in this app."
		>
			<ShownOrderList
				rows={layout.flatMap(({ tab, hidden }) => {
					if (ROWLESS_TABS.has(tab)) return [];
					const row = TAB_ROWS[tab];
					return [{
						key: tab,
						label: row.label,
						shown: !hidden,
						icon: row.icon,
						note:
							isWebModuleId(tab) && off.has(tab) ? (
								<>
									Shows only while turned on in{" "}
									<a href={hashForSettings("modules")} className={LINK}>
										Settings › Modules
									</a>
									.
								</>
							) : undefined,
					}];
				})}
				onShow={(tab, shown) => setLayout(prev => hideTab(prev, tab, !shown))}
				onMove={(tab, by) => setLayout(prev => moveTab(prev, tab, by))}
			/>
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

type SessionIdleChoice = "off" | "4" | "12" | "24" | "72";
const SESSION_IDLE_CHOICES: Record<SessionIdleChoice, string> = { off: "Off", "4": "After 4 hours", "12": "After 12 hours", "24": "After 24 hours", "72": "After 3 days" };

/** A select of `choices`, keyed by a setting's value as text, `off` for `null`. */
function IdleSelect<Choice extends string>({ label, choices, value, onChoose }: { label: string; choices: Record<Choice, string>; value: number | null; onChoose: (choice: Choice) => void }) {
	return (
		<Select<Choice> items={choices} value={(value === null ? "off" : String(value)) as Choice} onValueChange={next => next && onChoose(next)}>
			<SelectTrigger aria-label={label} className="w-fit">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{(Object.keys(choices) as Choice[]).map(choice => (
					<SelectItem key={choice} value={choice}>
						{choices[choice]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * When the server stops what sessions run besides omp, once every session a process serves has been idle that long, and
 * when it stops an idle session's omp. One read holds both, so a change to one never sends the other's stale value.
 */
function IdleStops() {
	const read = useEditableRead<ProcessSettings>("/api/process-settings");
	const [edited, setEdited] = useState<keyof ProcessSettings | null>(null);
	const settings = read.data;
	const change = (key: keyof ProcessSettings, value: number | null): void => {
		if (!settings) return;
		const next: ProcessSettings = { ...settings, [key]: value };
		setEdited(key);
		read.edit({ [key]: value }, () => putJson<ProcessSettings>("/api/process-settings", next));
	};
	return (
		<>
			<Section
				title="Stop idle processes"
				meta="Dev servers, watchers, and services a session starts besides omp. A process stops once every session it serves has been idle that long; hover the CPU at the foot of the left sidebar to see when. Saved on the server."
			>
				{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
				{settings && (
					<IdleSelect<IdleChoice>
						label="Stop idle processes"
						choices={IDLE_CHOICES}
						value={settings.stopIdleAfterMinutes}
						onChoose={choice => change("stopIdleAfterMinutes", STOP_IDLE_CHOICES.find(each => String(each ?? "off") === choice) ?? null)}
					/>
				)}
				{read.saveError && edited === "stopIdleAfterMinutes" && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{`Not saved: ${read.saveError}`}</p>}
			</Section>
			<Section
				title="Stop idle sessions"
				meta="Stops a session's omp once it has been idle that long with no subagent still running. It moves to Past with its worktree kept, and Resume picks it back up. Sessions started in a terminal, Bots' conversations, and private sessions keep running. Saved on the server."
			>
				{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
				{settings && (
					<IdleSelect<SessionIdleChoice>
						label="Stop idle sessions"
						choices={SESSION_IDLE_CHOICES}
						value={settings.stopIdleSessionsAfterHours}
						onChoose={choice => change("stopIdleSessionsAfterHours", STOP_IDLE_SESSION_CHOICES.find(each => String(each ?? "off") === choice) ?? null)}
					/>
				)}
				{read.saveError && edited === "stopIdleSessionsAfterHours" && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{`Not saved: ${read.saveError}`}</p>}
			</Section>
		</>
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
			<IdleStops />
			<PinnedSkill cwd={cwd} workspace={workspace} />
		</>
	);
}
