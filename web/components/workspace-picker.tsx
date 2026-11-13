/** The workspace picker: the searchable directory list for the roster and the new session's directory. */
import { IconFolder1, IconFolderAddRight } from "central-icons";
import { useContext, useState } from "react";
import { errorText } from "../../src/json";
import type { ControlId } from "../../src/shared/activity";
import type { Workspace } from "../../src/shared/workspaces";
import { sameDir, workspaceName } from "../labels";
import { createWorkspace } from "../reads";
import type { ShortcutId } from "../shortcuts";
import { CommandPicker, type PickerItem } from "./command-picker";
import { PersonalContext } from "./dashboard-context";
import { toasts } from "./toaster";

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

/** A working directory: a workspace of the space, **Personal** first in Personal, or any directory typed into the search field, used as is or created as a new workspace. */
export function DirectoryPicker({ cwd, workspaces, disabled, tooltip = cwd, shortcut, side = "top", open, onOpenChange, onPick, control }: DirectoryPickerProps) {
	const personal = useContext(PersonalContext);
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const pick = (next: string): void => {
		if (next !== cwd) onPick(next);
	};
	const create = async (path: string): Promise<void> => {
		try {
			await createWorkspace(path);
		} catch (error) {
			toasts.add({ title: `Could not create ${path}`, description: errorText(error) });
			return;
		}
		pick(path);
	};
	return (
		<CommandPicker
			trigger={workspaceName(workspaces.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd, personal) ?? cwd}
			icon={IconFolder1}
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
						items: workspaceItems(workspaces, cwd, personal, workspace => pick(workspace.cwdDisplay)),
					},
					...(typed && !workspaces.some(w => sameDir(typed, w))
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
										{
											value: `create ${typed}`,
											icon: IconFolderAddRight,
											label: (
												<span className="truncate">
													Create folder <span className="font-mono">{typed}</span>
												</span>
											),
											onSelect: () => void create(typed),
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
