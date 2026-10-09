import { Eye, EyeOff, FolderPlus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Project, ProjectChange, ProjectList } from "../../../src/shared/projects";
import { errorText, putJson } from "../../api";
import { projectName } from "../../labels";
import { IntegrationList } from "../integrations/integration-row";
import { Section } from "./editor";

function ProjectRow({ project, note, action }: { project: Project; note: string | null; action: ReactNode }) {
	return (
		<li className="flex items-center gap-3 px-4 py-2.5">
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-medium">{projectName(project.cwdDisplay) ?? project.cwdDisplay}</p>
				<p className="truncate text-xs text-muted-foreground">
					{project.cwdDisplay}
					{note && ` · ${note}`}
				</p>
			</div>
			{action}
		</li>
	);
}

interface ProjectsTabProps {
	/** What the pickers and the sidebar offer: directories sessions ran in, then the added ones. */
	projects: Project[];
	list: ProjectList<Project>;
}

/** The directories the pickers and the sidebar offer, a field to add one by path, and the hidden ones, each a click from coming back. */
export function ProjectsTab({ projects, list: { added, hidden } }: ProjectsTabProps) {
	const addedCwds = new Set(added.map(entry => entry.cwd));
	const [path, setPath] = useState("");
	const [pending, setPending] = useState<ProjectChange | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Whether the server took `change`; every page then hears the projects after it over its socket. */
	const change = async (next: ProjectChange): Promise<boolean> => {
		setPending(next);
		setError(null);
		try {
			await putJson("/api/projects", next);
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
			<Section title="Projects" meta="The directories the directory pickers and the sidebar's project picker offer. Hiding one also hides its sessions from the sidebar and search; a link to one still opens it.">
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
						Add project
					</Button>
				</form>
				{error && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
				{projects.length === 0 ? (
					<p className="text-sm text-muted-foreground">No projects yet. Start a session or add a directory.</p>
				) : (
					<IntegrationList label="Projects">
						{projects.map(project => (
							<ProjectRow
								key={project.cwd}
								project={project}
								note={addedCwds.has(project.cwd) ? "Added" : null}
								action={
									<Button variant="ghost" size="compact" leadingIcon={EyeOff} loading={pending?.op === "hide" && pending.cwd === project.cwd} disabled={pending !== null} onClick={() => void change({ op: "hide", cwd: project.cwd })}>
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
					<IntegrationList label="Hidden projects">
						{hidden.map(project => (
							<ProjectRow
								key={project.cwd}
								project={project}
								note={null}
								action={
									<Button variant="ghost" size="compact" leadingIcon={Eye} loading={pending?.op === "show" && pending.cwd === project.cwd} disabled={pending !== null} onClick={() => void change({ op: "show", cwd: project.cwd })}>
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
