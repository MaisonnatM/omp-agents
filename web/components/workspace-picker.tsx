/** The workspace picker: the searchable directory list for the roster and the new session's directory. */
import { Folder } from "lucide-react";
import { useContext, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import type { Workspace } from "../../src/shared/workspaces";
import { sameDir, workspaceName } from "../labels";
import type { ShortcutId } from "../shortcuts";
import { CommandPicker, type PickerItem } from "./command-picker";
import { PersonalContext } from "./dashboard-context";

/** The same visible directory row and search words for the roster and the new-session picker; `personal` reads as **Personal**. */
export function workspaceItems(workspaces: Workspace[], current: string | null, personal: Workspace | null, onPick: (workspace: Workspace) => void): PickerItem[] {
	return workspaces.map(workspace => ({
		value: workspace.cwd,
		keywords: [workspace.cwdDisplay],
		label: (
			<span className="flex min-w-0 flex-col">
				<span className="truncate">{workspaceName(workspace.cwdDisplay, personal) ?? workspace.cwdDisplay}</span>
				<span className="truncate text-xs text-muted-foreground">{workspace.cwdDisplay}</span>
			</span>
		),
		selected: current !== null && sameDir(current, workspace),
		onSelect: () => onPick(workspace),
	}));
}

interface DirectoryPickerProps {
	cwd: string;
	workspaces: Workspace[];
	disabled: boolean;
	/** What hovering the trigger says; `cwd` when omitted. */
	tooltip?: string;
	/** The shortcut that opens the list, which the tooltip shows; the caller binds it through `open`. */
	shortcut?: ShortcutId;
	/** Which side of the trigger the list opens on; the composer's opens upward. */
	side?: "top" | "bottom";
	/** Controlled when given, as a shortcut opens the list. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onPick: (cwd: string) => void;
	/** The Activity control a click on the trigger records; none when omitted. */
	control?: ControlId;
}

/** A working directory: a workspace the dashboard lists, or any directory typed into the search field; **Personal** opens from the sidebar instead. */
export function DirectoryPicker({ cwd, workspaces, disabled, tooltip = cwd, shortcut, side = "top", open, onOpenChange, onPick, control }: DirectoryPickerProps) {
	const personal = useContext(PersonalContext);
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const listed = personal ? workspaces.filter(workspace => !sameDir(workspace.cwd, personal)) : workspaces;
	const pick = (next: string): void => {
		if (next !== cwd) onPick(next);
	};
	return (
		<CommandPicker
			trigger={workspaceName(listed.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd, personal) ?? cwd}
			icon={Folder}
			control={control}
			ariaLabel={`Working directory: ${cwd}`}
			tooltip={tooltip}
			shortcut={shortcut}
			disabled={disabled}
			className="min-w-0"
			search={{ label: "Search or type a directory", query: { value: query, onChange: setQuery } }}
			width="lg"
			side={side}
			open={open}
			onOpenChange={next => {
				if (!next) setQuery("");
				onOpenChange?.(next);
			}}
			list={{
				kind: "ready",
				groups: [
					{
						key: "workspaces",
						heading: "Workspaces",
						items: workspaceItems(listed, cwd, personal, workspace => pick(workspace.cwdDisplay)),
					},
					...(typed && !listed.some(w => sameDir(typed, w))
						? [
								{
									key: "typed",
									forceMount: true,
									items: [
										{
											value: `use ${typed}`,
											label: (
											<span className="truncate">
												Use <span className="font-mono">{typed}</span>
											</span>
											),
											onSelect: () => pick(typed),
										},
									],
								},
							]
						: []),
				],
			}}
		/>
	);
}
