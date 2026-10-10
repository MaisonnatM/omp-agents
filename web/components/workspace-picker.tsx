import { Folder } from "lucide-react";
import { useState } from "react";
import type { Workspace } from "../../src/shared/workspaces";
import { folderName } from "../labels";
import type { ShortcutId } from "../shortcuts";
import { CommandPicker, type PickerItem } from "./command-picker";

/** The same visible directory row and search words for the roster and the new-session picker. */
export function workspaceItems(workspaces: Workspace[], current: string | null, onPick: (workspace: Workspace) => void): PickerItem[] {
	return workspaces.map(workspace => ({
		value: workspace.cwd,
		keywords: [workspace.cwdDisplay],
		label: (
			<span className="flex min-w-0 flex-col">
				<span className="truncate">{folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</span>
				<span className="truncate text-xs text-muted-foreground">{workspace.cwdDisplay}</span>
			</span>
		),
		selected: workspace.cwd === current || workspace.cwdDisplay === current,
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
}

/** A working directory: a workspace the dashboard lists, or any directory typed into the search field. */
export function DirectoryPicker({ cwd, workspaces, disabled, tooltip = cwd, shortcut, side = "top", open, onOpenChange, onPick }: DirectoryPickerProps) {
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const pick = (next: string): void => {
		if (next !== cwd) onPick(next);
	};
	return (
		<CommandPicker
			trigger={<span className="truncate">{folderName(cwd) ?? cwd}</span>}
			icon={Folder}
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
						items: workspaceItems(workspaces, cwd, workspace => pick(workspace.cwdDisplay)),
					},
					...(typed && !workspaces.some(w => w.cwd === typed || w.cwdDisplay === typed)
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
