import { Eye, EyeOff, FolderPlus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Workspace, WorkspaceChange, WorkspaceList } from "../../../src/shared/workspaces";
import { errorText, putJson } from "../../api";
import { folderName } from "../../labels";
import { IntegrationList } from "../integrations/integration-row";
import { Section } from "./editor";

function WorkspaceRow({ workspace, note, action }: { workspace: Workspace; note: string | null; action: ReactNode }) {
	return (
		<li className="flex items-center gap-3 px-4 py-2.5">
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-medium">{folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</p>
				<p className="truncate text-xs text-muted-foreground">
					{workspace.cwdDisplay}
					{note && ` · ${note}`}
				</p>
			</div>
			{action}
		</li>
	);
}

interface WorkspacesTabProps {
	/** What the pickers and the sidebar offer: directories sessions ran in, then the added ones. */
	workspaces: Workspace[];
	list: WorkspaceList<Workspace>;
}

/** The directories the pickers and the sidebar offer, a field to add one by path, and the hidden ones, each a click from coming back. */
export function WorkspacesTab({ workspaces, list: { added, hidden } }: WorkspacesTabProps) {
	const addedCwds = new Set(added.map(entry => entry.cwd));
	const [path, setPath] = useState("");
	const [pending, setPending] = useState<WorkspaceChange | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Whether the server took `change`; every page then hears the workspaces after it over its socket. */
	const change = async (next: WorkspaceChange): Promise<boolean> => {
		setPending(next);
		setError(null);
		try {
			await putJson("/api/workspaces", next);
			return true;
		} catch (err) {
			setError(errorText(err));
			return false;
		} finally {
			setPending(null);
		}
	};
	const add = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (await change({ op: "add", cwd: path })) setPath("");
	};
	return (
		<>
			<Section title="Workspaces" meta="The directories the directory pickers and the sidebar's workspace picker offer. Hiding one also hides its sessions from the sidebar and search; a link to one still opens it.">
				<form className="flex flex-wrap items-end gap-2" onSubmit={add}>
					<label className="space-y-1 text-sm">
						Directory
						<input
							value={path}
							onChange={event => setPath(event.target.value)}
							placeholder="~/code/app"
							className="block h-7 w-80 max-w-full rounded-md border border-border bg-transparent px-2"
						/>
					</label>
					<Button type="submit" variant="secondary" size="compact" leadingIcon={FolderPlus} loading={pending?.op === "add"} disabled={pending !== null || path.trim() === ""}>
						Add workspace
					</Button>
				</form>
				{error && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
				{workspaces.length === 0 ? (
					<p className="text-sm text-muted-foreground">No workspaces yet. Start a session or add a directory.</p>
				) : (
					<IntegrationList label="Workspaces">
						{workspaces.map(workspace => (
							<WorkspaceRow
								key={workspace.cwd}
								workspace={workspace}
								note={addedCwds.has(workspace.cwd) ? "Added" : null}
								action={
									<Button variant="ghost" size="compact" leadingIcon={EyeOff} loading={pending?.op === "hide" && pending.cwd === workspace.cwd} disabled={pending !== null} onClick={() => void change({ op: "hide", cwd: workspace.cwd })}>
										Hide
									</Button>
								}
							/>
						))}
					</IntegrationList>
				)}
			</Section>
			{hidden.length > 0 && (
				<Section title="Hidden" meta="Left out of the pickers and the sidebar, with their sessions.">
					<IntegrationList label="Hidden workspaces">
						{hidden.map(workspace => (
							<WorkspaceRow
								key={workspace.cwd}
								workspace={workspace}
								note={null}
								action={
									<Button variant="ghost" size="compact" leadingIcon={Eye} loading={pending?.op === "show" && pending.cwd === workspace.cwd} disabled={pending !== null} onClick={() => void change({ op: "show", cwd: workspace.cwd })}>
										Show
									</Button>
								}
							/>
						))}
					</IntegrationList>
				</Section>
			)}
		</>
	);
}
