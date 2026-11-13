import { IconChevronGrabberVertical, IconKeyboard } from "central-icons";
import { isSpace, type Space, SPACES } from "../../src/shared/workspaces";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuShortcut } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { SPACE_LABELS, sessionsWaiting } from "../labels";
import { SPACE_ICONS } from "../page-icons";
import { shortcutLabels } from "../shortcuts";
import { CountPill } from "./count-pill";

interface SpaceSwitchProps {
	space: Space;
	onSpace: (space: Space) => void;
	/** How many sessions of the other space need you, counted on its row and as a dot on the button. */
	otherWaiting: number;
	/** How many workspaces the space lists, under its name. */
	workspaces: number;
	onShowShortcuts: () => void;
}

/** The sidebar's foot: the space the window shows, as an account row whose menu switches to the other space and opens the keyboard shortcuts. */
export function SpaceSwitch({ space, onSpace, otherWaiting, workspaces, onShowShortcuts }: SpaceSwitchProps) {
	const label = SPACE_LABELS[space];
	const Icon = SPACE_ICONS[space];
	return (
		<DropdownMenu>
			<SidebarMenu>
				<SidebarMenuItem>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								size="lg"
								className="px-2 data-[popup-open]:bg-hover"
								aria-label={`${label} space. Switch space${otherWaiting > 0 ? `, ${sessionsWaiting(otherWaiting)} in the other` : ""}`}
							/>
						}
					>
						<span aria-hidden className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
							<Icon className="size-4" />
							{otherWaiting > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar" />}
						</span>
						<span className="min-w-0 flex-1 text-left leading-tight">
							<span className="block truncate text-[13px] font-medium">{label}</span>
							<span className="block truncate text-xs text-muted-foreground">
								{workspaces} workspace{workspaces === 1 ? "" : "s"}
							</span>
						</span>
						<IconChevronGrabberVertical aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
					</DropdownMenuTrigger>
				</SidebarMenuItem>
			</SidebarMenu>
			<DropdownMenuContent side="top" align="start" className="w-60">
				<MenuRadioGroup value={space} onValueChange={(value: string) => isSpace(value) && onSpace(value)}>
					{SPACES.map(value => {
						const SpaceIcon = SPACE_ICONS[value];
						const waiting = value === space ? 0 : otherWaiting;
						return (
							<MenuRadioItem
								key={value}
								{...activityControl(`sidebar.space.${value}` as const)}
								value={value}
								closeOnClick
								aria-label={waiting > 0 ? `${SPACE_LABELS[value]}, ${sessionsWaiting(waiting)}` : undefined}
							>
								<SpaceIcon />
								{SPACE_LABELS[value]}
								{waiting > 0 && <CountPill count={waiting} />}
								{value !== space && <MenuShortcut>{shortcutLabels("switchSpace").join(" ")}</MenuShortcut>}
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuItem {...activityControl("shortcuts.open")} onClick={onShowShortcuts}>
					<IconKeyboard />
					Keyboard shortcuts
					<MenuShortcut>{shortcutLabels("help").join(" ")}</MenuShortcut>
				</MenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
