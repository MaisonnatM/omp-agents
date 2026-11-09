import { Eye, EyeOff, FolderOpen, FolderPlus, ShieldOff } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TrustChange, TrustedProject } from "../../../src/shared/project-trust";
import { type Space, SPACES, spaces, type Workspace, type WorkspaceChange, type WorkspaceList } from "../../../src/shared/workspaces";
import { putJson } from "../../api";
import { folderName, SPACE_LABELS } from "../../labels";
import { writeWorkspace } from "../../reads";
import { useAction } from "../../use-action";
import { IntegrationList } from "../integrations/integration-row";
import { Section } from "./editor";

/** The desktop app's bridge, whose folder dialog picks a workspace; absent in a browser, which keeps the typed path alone. */
const desktop = typeof window === "undefined" ? undefined : window.ompDesktop;

const SPACE_ITEMS = SPACES.map(value => ({ value, label: SPACE_LABELS[value] }));

/** The space a workspace is in, which a session started there takes: Work, or Personal with the personal memory and its tools. */
function SpacePicker({ workspace, space, disabled, onPick }: { workspace: Workspace; space: Space; disabled: boolean; onPick: (space: Space) => void }) {
	return (
		<Select<Space> items={SPACE_ITEMS} value={space} disabled={disabled} onValueChange={next => next && next !== space && onPick(next)}>
			<SelectTrigger aria-label={`Space of ${folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}`} className="w-fit">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{SPACE_ITEMS.map(({ value, label }) => (
					<SelectItem key={value} value={value}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function WorkspaceRow({ workspace, note, action }: { workspace: Workspace; note: string | null; action: ReactNode }) {
	return (
		<li className="flex items-center gap-3 px-4 py-2.5">
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-medium">{folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</p>
				<p className="break-all text-xs text-muted-foreground">
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
	/** The dashboard's personal directory; `null` until the server sends it, and until then no row offers a space. */
	personalDir: Workspace | null;
	trustedProjects: TrustedProject[];
}

/** Sends changes through `write` one at a time: the change under way, and why the last one failed. Every page then hears the list after it over its socket. */
function useChanges<C>(write: (change: C) => Promise<unknown>) {
	const action = useAction(async (next: C, done: () => void) => {
		await write(next);
		done();
	}, null);
	const pending = action.state.kind === "pending" ? action.state.args[0] : null;
	/** Sends `next`, then runs `done` once the server took it. */
	const change = (next: C, done = (): void => {}): void => action.run(next, done);
	return { pending, error: action.error, change };
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
	const { pending, error, change } = useChanges<TrustChange>(next => putJson("/api/project-trust", next));
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
								<Button variant="ghost" size="compact" leadingIcon={ShieldOff} loading={pending?.root === root} disabled={pending !== null} onClick={() => change({ op: "forget", root })}>
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

/** The directories the pickers and the sidebar offer, each with its space, a field to add one by path or, in the desktop app, from the folder dialog, the hidden ones, each a click from coming back, and the trusted projects. */
export function WorkspacesTab({ workspaces, list: { added, hidden, personal }, personalDir, trustedProjects }: WorkspacesTabProps) {
	const addedCwds = new Set(added.map(entry => entry.cwd));
	const inSpaces = personalDir && spaces(personal.map(entry => entry.cwd), personalDir);
	const [path, setPath] = useState("");
	const { pending, error, change } = useChanges<WorkspaceChange>(writeWorkspace);
	const add = (event: FormEvent): void => {
		event.preventDefault();
		change({ op: "add", cwd: path }, () => setPath(""));
	};
	const choose = async (): Promise<void> => {
		const cwd = await desktop?.pickDirectory?.();
		if (cwd) change({ op: "add", cwd });
	};
	return (
		<>
			<Section
				meta={
					<>
						The directories the directory pickers and the sidebar's workspace picker offer. Hiding one also hides its sessions from the sidebar and search; a link to one still opens it.
						<span className="mt-1 block">A session in a Personal workspace remembers what you tell it about your life and can log sport. Work is the default.</span>
					</>
				}
			>
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
									<>
										{inSpaces?.isPersonalDir(workspace.cwd) ? (
											<Badge variant="dot" size="compact" className="shrink-0">
												Personal
											</Badge>
										) : (
											inSpaces && <SpacePicker workspace={workspace} space={inSpaces.of(workspace.cwd, workspace.cwd)} disabled={pending !== null} onPick={space => change({ op: "space", cwd: workspace.cwd, space })} />
										)}
										<Button variant="ghost" size="compact" leadingIcon={EyeOff} loading={pending?.op === "hide" && pending.cwd === workspace.cwd} disabled={pending !== null} onClick={() => change({ op: "hide", cwd: workspace.cwd })}>
											Hide
										</Button>
									</>
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
									<Button variant="ghost" size="compact" leadingIcon={Eye} loading={pending?.op === "show" && pending.cwd === workspace.cwd} disabled={pending !== null} onClick={() => change({ op: "show", cwd: workspace.cwd })}>
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
