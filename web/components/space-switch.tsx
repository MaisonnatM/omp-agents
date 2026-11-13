import { ChevronsUpDown, Keyboard } from "lucide-react";
import { isSpace, type Space, SPACES } from "../../src/shared/workspaces";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuShortcut } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { SPACE_LABELS, sessionsWaiting } from "../labels";
import { SPACE_ICONS } from "../page-icons";
import { shortcutLabels } from "../shortcuts";

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
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={`${label} space. Switch space${otherWaiting > 0 ? `, ${sessionsWaiting(otherWaiting)} in the other` : ""}`}
						className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-hover"
					/>
				}
			>
				<span aria-hidden className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-sm font-semibold text-white">
					{label[0]}
					{otherWaiting > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar" />}
				</span>
				<span className="min-w-0 flex-1 leading-tight">
					<span className="block truncate text-[13px] font-medium">{label}</span>
					<span className="block truncate text-xs text-muted-foreground">
						{workspaces} workspace{workspaces === 1 ? "" : "s"}
					</span>
				</span>
				<ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
			</DropdownMenuTrigger>
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
								{waiting > 0 && (
									<span aria-hidden className="min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold tabular-nums text-primary-foreground">
										{waiting}
									</span>
								)}
								{value !== space && <MenuShortcut>{shortcutLabels("switchSpace").join(" ")}</MenuShortcut>}
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuItem {...activityControl("shortcuts.open")} onClick={onShowShortcuts}>
					<Keyboard />
					Keyboard shortcuts
					<MenuShortcut>{shortcutLabels("help").join(" ")}</MenuShortcut>
				</MenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
