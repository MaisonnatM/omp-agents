import { Archive, ArrowLeft, FileText, Pencil, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { type ConnectedModels, type ModelOption, selectorOf } from "../../../src/shared/models";
import { DEFAULT_PROJECT_NAME, type Project, type ProjectNote, type ProjectUpdate, type WorkerPhase } from "../../../src/shared/projects";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { modeOf, readTime, SPLIT_CLICK } from "../../labels";
import { useRead } from "../../reads";
import { hashForProjects, type ProjectsTarget } from "../../routing";
import { projectSession } from "../../sessions";
import type { StartOf } from "../../starts";
import { useDefaultModel } from "../../use-default-model";
import { Age } from "../age";
import { useDashboardActions } from "../dashboard-context";
import { PageFrame } from "../list-page";
import { type ModelMenuOpen, ModelPicker } from "../model-picker";
import { MoreActionsMenu } from "../more-actions-menu";
import { DirectoryPicker } from "../workspace-picker";

const FIELD = "rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const PHASE_LABEL: Record<WorkerPhase, string> = { working: "Working", asking: "Asks you", idle: "Idle", interrupted: "Interrupted", ended: "Ended" };

/** What an update waiting for the coordinator says about its worker. */
function updateText(update: ProjectUpdate): string {
	switch (update.kind) {
		case "finished":
			return "Finished a turn";
		case "asked":
			return `Asks: ${update.question}`;
		case "stopped":
			return "Stopped";
		default: {
			const never: never = update;
			return never;
		}
	}
}

interface NewProjectProps {
	/** What the form starts with: a failed start's fields, so a retry keeps them, else an empty form in the default workspace. */
	initial: { name: string; cwd: string; prompt: string; model: ModelOption | null; thinking: string | null };
	workspaces: Workspace[];
	connected: boolean;
	launch: StartOf<"project"> | null;
	onCancel: () => void;
}

/** A new project's name, workspace, model and effort, and the first message its coordinator starts on. */
function NewProject({ initial, workspaces, connected, launch, onCancel }: NewProjectProps) {
	const { start } = useDashboardActions();
	const id = useId();
	const [name, setName] = useState(initial.name);
	const [cwd, setCwd] = useState(initial.cwd);
	const [prompt, setPrompt] = useState(initial.prompt);
	/** `null` leaves omp's default model, which the picker shows until a pick. */
	const [model, setModel] = useState(initial.model);
	/** A level holds for the model it was picked on, `null` for omp's default, as on the new-session draft. */
	const [pickedThinking, setPickedThinking] = useState(initial.thinking === null ? null : { model: initial.model && selectorOf(initial.model), level: initial.thinking });
	const [tried, setTried] = useState(false);
	const defaultModel = useDefaultModel(cwd);
	const shownModel = model ?? defaultModel;
	const [modelsOpen, setModelsOpen] = useState<ModelMenuOpen | null>(null);
	// Reopening reads credentials and model capabilities again after a provider login.
	const [modelOpens, setModelOpens] = useState(0);
	const modelsRead = useRead<ConnectedModels>(`/api/models/connected?cwd=${encodeURIComponent(cwd)}`, modelOpens);
	const pickedSelector = model && selectorOf(model);
	const shownSelector = shownModel ? selectorOf(shownModel) : null;
	const levels = modelsRead.data?.models.find(entry => selectorOf(entry) === shownSelector)?.thinkingLevels ?? null;
	const thinking = pickedThinking?.model === pickedSelector && levels?.includes(pickedThinking.level) ? pickedThinking.level : null;
	const starting = launch?.phase === "starting";
	const missingPrompt = prompt.trim() === "";
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		setTried(true);
		if (!missingPrompt) start({ kind: "project", name: name.trim(), cwd, prompt: prompt.trim(), model, thinking });
	};
	return (
		<PageFrame title="New project" meta="A coordinator agent plans the work and starts worker sessions">
			<form className="mx-auto w-full max-w-2xl space-y-6 px-6 py-6" onSubmit={submit}>
				<div className="space-y-1.5">
					<label htmlFor={`${id}-name`} className="block text-sm font-medium">
						Name
					</label>
					<input
						id={`${id}-name`}
						autoFocus
						value={name}
						placeholder={DEFAULT_PROJECT_NAME}
						disabled={starting}
						onChange={event => setName(event.target.value)}
						className={cn(FIELD, "h-7 w-full")}
					/>
				</div>
				<div className="space-y-1.5">
					<p className="block text-sm font-medium">Workspace</p>
					<DirectoryPicker cwd={cwd} workspaces={workspaces} disabled={starting} side="bottom" onPick={setCwd} />
					<p className="text-xs text-muted-foreground">The coordinator starts here, and so does each worker unless the coordinator names another directory.</p>
				</div>
				<div className="space-y-1.5">
					<p className="block text-sm font-medium">Model</p>
					<ModelPicker
						current={shownSelector}
						unset="Default model"
						list={modelsRead}
						open={modelsOpen}
						onOpenChange={next => {
							if (next !== null && modelsOpen === null) setModelOpens(count => count + 1);
							setModelsOpen(next);
						}}
						onPick={setModel}
						effort={{
							current: thinking,
							levels: modelsRead.error === null ? levels : [],
							onPick: level => setPickedThinking(level === null ? null : { model: pickedSelector, level }),
							allowDefault: true,
						}}
						disabled={starting || !connected}
					/>
					<p className="text-xs text-muted-foreground">The coordinator's model. Workers start on omp's default model.</p>
				</div>
				<div className="space-y-1.5">
					<label htmlFor={`${id}-prompt`} className="block text-sm font-medium">
						First message
					</label>
					<textarea
						id={`${id}-prompt`}
						value={prompt}
						rows={6}
						required
						disabled={starting}
						placeholder="What the project should get done."
						aria-invalid={tried && missingPrompt ? true : undefined}
						onChange={event => setPrompt(event.target.value)}
						className={cn(FIELD, "w-full py-1.5")}
					/>
					<p className="text-xs text-muted-foreground">The coordinator plans from it, and keeps its plan and findings in the project's notes.</p>
				</div>
				<div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
					<Button type="submit" disabled={!connected} loading={starting}>
						{starting ? "Starting coordinator…" : "Create project"}
					</Button>
					<Button type="button" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					{tried && missingPrompt && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							Write the first message.
						</p>
					)}
					{launch?.phase === "failed" && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							{launch.error}
						</p>
					)}
				</div>
			</form>
		</PageFrame>
	);
}

/** The project's menu: **Rename**, and **Archive**, which asks first in its place. */
function ProjectActions({ project, connected, onRename }: { project: Project; connected: boolean; onRename: () => void }) {
	const { send } = useDashboardActions();
	const [confirming, setConfirming] = useState(false);
	if (confirming) {
		return (
			<div role="group" aria-label={`Archive ${project.name}?`} className="flex shrink-0 items-center gap-2 text-xs">
				<span>Archive it? Its sessions go back to the session lists, and its coordinator can no longer start, read, or message workers.</span>
				<Button
					size="compact"
					disabled={!connected}
					onClick={() => {
						send({ t: "project", change: { op: "archive", id: project.id } });
						location.hash = hashForProjects({ kind: "list" });
					}}
				>
					Archive project
				</Button>
				<Button variant="ghost" size="compact" autoFocus onClick={() => setConfirming(false)}>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<MoreActionsMenu name={project.name} disabled={!connected}>
			<MenuItem onClick={onRename}>
				<Pencil />
				Rename
			</MenuItem>
			{!project.archived && (
				<MenuItem variant="destructive" onClick={() => setConfirming(true)}>
					<Archive />
					Archive
				</MenuItem>
			)}
		</MoreActionsMenu>
	);
}

/** The project's name in a field, saved on Enter or **Save**; an empty name reads as New project. */
function RenameForm({ project, onDone }: { project: Project; onDone: () => void }) {
	const { send } = useDashboardActions();
	const [name, setName] = useState(project.name);
	return (
		<form
			aria-label={`Rename ${project.name}`}
			className="flex items-center gap-2"
			onSubmit={event => {
				event.preventDefault();
				if (name.trim() !== project.name) send({ t: "project", change: { op: "rename", id: project.id, name: name.trim() } });
				onDone();
			}}
		>
			<input
				aria-label="Project name"
				autoFocus
				value={name}
				placeholder={DEFAULT_PROJECT_NAME}
				onChange={event => setName(event.target.value)}
				onKeyDown={event => {
					if (event.key === "Escape") onDone();
				}}
				className={cn(FIELD, "h-7 min-w-0 flex-1")}
			/>
			<Button type="submit" size="compact">
				Save
			</Button>
			<Button type="button" variant="ghost" size="compact" onClick={onDone}>
				Cancel
			</Button>
		</form>
	);
}

/** The project's notes directory and its files, each opening in the file dialog; read again whenever the project changes. */
function ProjectNotes({ project }: { project: Project }) {
	const { openFile } = useDashboardActions();
	const notes = useRead<{ dir: string; notes: ProjectNote[] }>(`/api/project-notes?id=${encodeURIComponent(project.id)}`, project);
	return (
		<section aria-labelledby="project-notes" className="space-y-2">
			<h3 id="project-notes" className="text-sm font-medium">
				Notes
			</h3>
			{notes.error !== null && notes.data === null ? (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					{notes.error}
				</p>
			) : notes.data === null ? (
				<p className="text-sm text-muted-foreground">Reading the notes…</p>
			) : notes.data.notes.length === 0 ? (
				<p className="text-sm text-muted-foreground">No notes yet. The coordinator and its workers write them as they go.</p>
			) : (
				<ul aria-label="Notes" className="divide-y divide-border overflow-hidden rounded-md border border-border">
					{notes.data.notes.map(note => (
						<li key={note.path}>
							<button type="button" title={note.path} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none" onClick={() => openFile(note.path)}>
								<FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{note.name}</span>
								<Age at={Date.parse(note.modifiedAt)} exact className="shrink-0 text-xs tabular-nums text-muted-foreground" />
							</button>
						</li>
					))}
				</ul>
			)}
			{notes.data && <p className="font-mono text-xs break-all text-muted-foreground">{notes.data.dir}</p>}
		</section>
	);
}

interface DetailProps {
	project: Project;
	hosts: RosterHost[];
	past: PastSession[];
	connected: boolean;
}

/** One project: its coordinator, its workers, the updates waiting for the coordinator, and its notes. */
function ProjectDetail({ project, hosts, past, connected }: DetailProps) {
	const { open } = useDashboardActions();
	const [renaming, setRenaming] = useState(false);
	const coordinator = projectSession(project.coordinator.sessionId, hosts, past);
	const coordinatorView = coordinator.view;
	return (
		<PageFrame
			title={project.name}
			meta={`${coordinator.cwdDisplay ?? project.cwd} · Coordinator: ${PHASE_LABEL[coordinator.phase]}${project.archived ? " · Archived" : ""}`}
			actions={
				<>
					<Button asChild variant="ghost" size="compact" leadingIcon={ArrowLeft}>
						<a href={hashForProjects({ kind: "list" })}>All projects</a>
					</Button>
					<Button size="compact" disabled={coordinatorView === null} title={`${SPLIT_CLICK} to open in a split`} onClick={event => coordinatorView && open(coordinatorView, modeOf(event))}>
						Open coordinator
					</Button>
					<ProjectActions project={project} connected={connected} onRename={() => setRenaming(true)} />
				</>
			}
		>
			<div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-6">
				{renaming && <RenameForm project={project} onDone={() => setRenaming(false)} />}
				<section aria-labelledby="project-workers" className="space-y-2">
					<h3 id="project-workers" className="text-sm font-medium">
						Workers
					</h3>
					{project.workers.length === 0 ? (
						<p className="text-sm text-muted-foreground">No workers yet. The coordinator starts them as it plans.</p>
					) : (
						<div className="overflow-x-auto rounded-md border border-border">
							<table className="w-full text-left text-sm">
								<thead className="border-b border-border text-xs text-muted-foreground">
									<tr>
										<th scope="col" className="px-3 py-2 font-medium">Worker</th>
										<th scope="col" className="px-3 py-2 font-medium">Task</th>
										<th scope="col" className="px-3 py-2 font-medium">Status</th>
										<th scope="col" className="px-3 py-2 font-medium">Directory</th>
										<th scope="col" className="px-3 py-2 font-medium">Last reply</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border">
									{project.workers.map(worker => {
										const { view, phase, cwdDisplay } = projectSession(worker.sessionId, hosts, past);
										const reply = worker.lastReply?.text.trim().split("\n")[0];
										return (
											<tr key={worker.id} className="align-top">
												<td className="px-3 py-2 font-mono text-xs">{worker.id}</td>
												<td className="max-w-56 px-3 py-2">
													{view ? (
														<button
															type="button"
															title={`Open the session (${SPLIT_CLICK} to split)`}
															className="text-left font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
															onClick={event => open(view, modeOf(event))}
														>
															{worker.title}
														</button>
													) : (
														<span className="font-medium">{worker.title}</span>
													)}
												</td>
												<td className="px-3 py-2 whitespace-nowrap">{PHASE_LABEL[phase]}</td>
												<td className="max-w-48 truncate px-3 py-2 font-mono text-xs" title={worker.cwd}>
													{cwdDisplay ?? worker.cwd}
												</td>
												<td className="max-w-72 truncate px-3 py-2 text-muted-foreground" title={worker.lastReply?.text}>
													{reply || "No reply yet"}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
				{project.updates.length > 0 && (
					<section aria-labelledby="project-updates" className="space-y-2">
						<h3 id="project-updates" className="text-sm font-medium">
							Pending updates
						</h3>
						<ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{project.updates.map(update => (
								<li key={update.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
									<span className="shrink-0 font-mono text-xs">{update.workerId}</span>
									<span className="min-w-0 flex-1 break-words">{updateText(update)}</span>
									<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{readTime(Date.parse(update.at))}</span>
								</li>
							))}
						</ul>
						<p className="text-xs text-muted-foreground">They reach the coordinator together once it runs and waits for you.</p>
					</section>
				)}
				<ProjectNotes project={project} />
			</div>
		</PageFrame>
	);
}

/** A project in the list, muted once archived. */
function ProjectRow({ project }: { project: Project }) {
	const workers = project.workers.length;
	return (
		<li className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
			<div className="min-w-0 flex-1 space-y-0.5">
				<a
					href={hashForProjects({ kind: "project", id: project.id })}
					className={cn(
						"block truncate rounded-sm text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
						project.archived && "text-muted-foreground",
					)}
				>
					{project.name}
				</a>
				<p className="truncate font-mono text-xs text-muted-foreground">{project.cwd}</p>
			</div>
			<p className="shrink-0 text-xs text-muted-foreground">{workers === 0 ? "No workers" : workers === 1 ? "1 worker" : `${workers} workers`}</p>
		</li>
	);
}

interface ProjectsPageProps {
	/** Every project, archived ones too. */
	projects: Project[];
	/** What shows: the list, the New project form, or one project; a project the list does not name shows the list. */
	target: ProjectsTarget;
	/** Every live and past session, wherever it runs: a project's workers may run in `/tmp`, which the sidebar hides. */
	hosts: RosterHost[];
	past: PastSession[];
	/** The workspaces, which the new project's workspace picker offers. */
	workspaces: Workspace[];
	/** Where a new project starts until you pick another directory. */
	defaultCwd: string;
	connected: boolean;
	/** The project start under way or failed, if there is one; its form stays open until it starts or you cancel. */
	launch: StartOf<"project"> | null;
}

/** Your projects, one project's page, or the form for a new one. */
export function ProjectsPage({ projects, target, hosts, past, workspaces, defaultCwd, connected, launch }: ProjectsPageProps) {
	const { dismissStart } = useDashboardActions();
	const startNew = (): void => {
		dismissStart("project");
		location.hash = hashForProjects({ kind: "new" });
	};

	// A start under way or failed keeps its form on the list's page too, so leaving and coming back finds it.
	if (target.kind === "new" || (launch !== null && target.kind === "list")) {
		return (
			<NewProject
				initial={launch?.op ?? { name: "", cwd: defaultCwd, prompt: "", model: null, thinking: null }}
				workspaces={workspaces}
				connected={connected}
				launch={launch}
				onCancel={() => {
					dismissStart("project");
					location.hash = hashForProjects({ kind: "list" });
				}}
			/>
		);
	}

	const shown = target.kind === "project" ? projects.find(project => project.id === target.id) : undefined;
	if (shown) return <ProjectDetail project={shown} hosts={hosts} past={past} connected={connected} />;

	const active = projects.filter(project => !project.archived);
	const archived = projects.filter(project => project.archived);
	return (
		<PageFrame
			title="Projects"
			meta={active.length === 0 ? "A coordinator agent plans the work and starts worker sessions" : active.length === 1 ? "1 project" : `${active.length} projects`}
			actions={
				active.length > 0 && (
					<Button variant="secondary" size="compact" leadingIcon={Plus} disabled={!connected} onClick={startNew}>
						New project
					</Button>
				)
			}
		>
			<div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-6">
				{active.length === 0 ? (
					<div className="mx-auto max-w-md space-y-3 py-10 text-center">
						<p className="text-sm font-medium">No projects yet</p>
						<p className="text-sm text-muted-foreground">
							A project starts a coordinator agent on your first message. It plans the work, starts worker sessions for the parts, and hears when each finishes or asks you
							something. The coordinator and its workers share one folder of notes.
						</p>
						<Button size="compact" leadingIcon={Plus} disabled={!connected} onClick={startNew}>
							New project
						</Button>
					</div>
				) : (
					<ul aria-label="Projects" className="divide-y divide-border overflow-hidden rounded-md border border-border">
						{active.map(project => (
							<ProjectRow key={project.id} project={project} />
						))}
					</ul>
				)}
				{archived.length > 0 && (
					<section aria-labelledby="archived-projects" className="space-y-2">
						<h3 id="archived-projects" className="text-sm font-medium text-muted-foreground">
							Archived
						</h3>
						<ul aria-label="Archived projects" className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{archived.map(project => (
								<ProjectRow key={project.id} project={project} />
							))}
						</ul>
					</section>
				)}
			</div>
		</PageFrame>
	);
}
