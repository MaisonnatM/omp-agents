import { Folder } from "lucide-react";
import { useState } from "react";
import { projectName } from "../labels";
import { CommandPicker, type PickerItem } from "./command-picker";

export interface Workspace {
	cwd: string;
	cwdDisplay: string;
}

/** The same visible directory row and search words for the roster and the new-session picker. */
export function workspaceItems(workspaces: Workspace[], current: string | null, onPick: (workspace: Workspace) => void): PickerItem[] {
	return workspaces.map(workspace => ({
		value: workspace.cwd,
		keywords: [workspace.cwdDisplay],
		label: (
			<span className="flex min-w-0 flex-col">
				<span className="truncate">{projectName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</span>
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
	/** Which side of the trigger the list opens on; the composer's opens upward. */
	side?: "top" | "bottom";
	onPick: (cwd: string) => void;
}

/** The directory the session starts in: one a session ran in, or any directory typed into the search field. */
export function DirectoryPicker({ cwd, workspaces, disabled, side = "top", onPick }: DirectoryPickerProps) {
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const pick = (next: string): void => {
		if (next !== cwd) onPick(next);
	};
	return (
		<CommandPicker
			trigger={<span className="truncate">{projectName(cwd) ?? cwd}</span>}
			icon={Folder}
			ariaLabel={`Working directory: ${cwd}`}
			tooltip={cwd}
			disabled={disabled}
			className="min-w-0"
			search={{ label: "Search or type a directory", query: { value: query, onChange: setQuery } }}
			width="lg"
			side={side}
			onOpenChange={next => {
				if (!next) setQuery("");
			}}
			list={{
				kind: "ready",
				groups: [
					{
						key: "workspaces",
						heading: "Directories sessions ran in",
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
