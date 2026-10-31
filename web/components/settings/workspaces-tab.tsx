import { Eye, EyeOff, FolderOpen, FolderPlus, ShieldOff } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TrustChange, TrustedProject } from "../../../src/shared/project-trust";
import type { Workspace, WorkspaceChange, WorkspaceList } from "../../../src/shared/workspaces";
import { errorText } from "../../../src/json";
import { putJson } from "../../api";
import { folderName } from "../../labels";
import { IntegrationList } from "../integrations/integration-row";
import { Section } from "./editor";

/** The desktop app's bridge, whose folder dialog picks a workspace; absent in a browser, which keeps the typed path alone. */
const desktop = typeof window === "undefined" ? undefined : window.ompDesktop;

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
	trustedProjects: TrustedProject[];
}

/** Sends changes to `url` one at a time: the change under way, and why the last one failed. Every page then hears the list after it over its socket. */
function useChanges<C>(url: string) {
	const [pending, setPending] = useState<C | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Whether the server took `next`. */
	const change = async (next: C): Promise<boolean> => {
		setPending(next);
		setError(null);
		try {
			await putJson(url, next);
			return true;
		} catch (err) {
			setError(errorText(err));
			return false;
		} finally {
			setPending(null);
		}
	};
	return { pending, error, change };
}

function ChangeError({ error }: { error: string | null }) {
	if (!error) return null;
	return (
		<p role="alert" className="text-xs text-red-600 dark:text-red-400">
			{error}
		</p>
	);
}

/** The projects whose agent code a start asked about and the user trusted, each a click from asking again. */
function TrustedProjects({ projects }: { projects: TrustedProject[] }) {
	const { pending, error, change } = useChanges<TrustChange>("/api/project-trust");
	return (
		<Section title="Trusted projects" meta="Projects whose own agent code, such as extensions, tools, MCP servers, and settings, you trusted when a session started there. A piece that changes asks again.">
			<ChangeError error={error} />
			{projects.length === 0 ? (
				<p className="text-sm text-muted-foreground">No trusted projects yet.</p>
			) : (
				<IntegrationList label="Trusted projects">
					{projects.map(({ root, rootDisplay, pieces }) => (
						<WorkspaceRow
							key={root}
							workspace={{ cwd: root, cwdDisplay: rootDisplay }}
							note={pieces === 1 ? "1 piece of agent code" : `${pieces} pieces of agent code`}
							action={
								<Button variant="ghost" size="compact" leadingIcon={ShieldOff} loading={pending?.root === root} disabled={pending !== null} onClick={() => void change({ op: "forget", root })}>
									Stop trusting
								</Button>
							}
						/>
					))}
				</IntegrationList>
			)}
		</Section>
	);
}

/** The directories the pickers and the sidebar offer, a field to add one by path or, in the desktop app, from the folder dialog, the hidden ones, each a click from coming back, and the trusted projects. */
export function WorkspacesTab({ workspaces, list: { added, hidden }, trustedProjects }: WorkspacesTabProps) {
	const addedCwds = new Set(added.map(entry => entry.cwd));
	const [path, setPath] = useState("");
	const { pending, error, change } = useChanges<WorkspaceChange>("/api/workspaces");
	const add = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (await change({ op: "add", cwd: path })) setPath("");
	};
	const choose = async (): Promise<void> => {
		const cwd = await desktop?.pickDirectory?.();
		if (cwd) await change({ op: "add", cwd });
	};
	return (
		<>
			<Section meta="The directories the directory pickers and the sidebar's workspace picker offer. Hiding one also hides its sessions from the sidebar and search; a link to one still opens it.">
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
					{desktop?.pickDirectory && (
						<Button type="button" variant="ghost" size="compact" leadingIcon={FolderOpen} disabled={pending !== null} onClick={() => void choose()}>
							Choose folder…
						</Button>
					)}
				</form>
				<ChangeError error={error} />
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
			<TrustedProjects projects={trustedProjects} />
		</>
	);
}
