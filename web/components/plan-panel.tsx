import { Circle, CircleAlert, CircleCheck, CircleDot, CircleSlash, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ChangedFile, TodoPhase, TodoStatus, View } from "../../src/shared";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { usePane } from "../pane-store";

const TASK_LOOK: Record<TodoStatus, { icon: LucideIcon; label: string; className: string }> = {
	pending: { icon: Circle, label: "Pending", className: "text-foreground" },
	in_progress: { icon: CircleDot, label: "In progress", className: "bg-accent font-medium text-foreground [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400" },
	completed: { icon: CircleCheck, label: "Completed", className: "text-muted-foreground line-through" },
	abandoned: { icon: CircleSlash, label: "Abandoned", className: "text-muted-foreground/60" },
	blocked: { icon: CircleAlert, label: "Blocked", className: "text-foreground [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400" },
};

function Phase({ phase }: { phase: TodoPhase }) {
	const done = phase.tasks.filter(task => task.status === "completed").length;
	return (
		<SidebarGroup>
			<SidebarGroupLabel>
				<span className="min-w-0 flex-1 truncate">{phase.name}</span>
				<span className="tabular-nums" aria-label={`${done} of ${phase.tasks.length} done`}>
					{done}/{phase.tasks.length}
				</span>
			</SidebarGroupLabel>
			<ol className="flex flex-col gap-0.5 px-2" aria-label={phase.name}>
				{phase.tasks.map((task, index) => {
					const look = TASK_LOOK[task.status];
					const Icon = look.icon;
					return (
						<li
							key={index}
							className={cn("flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0", look.className)}
							aria-current={task.status === "in_progress" ? "step" : undefined}
							data-status={task.status}
						>
							<Icon aria-label={look.label} role="img" />
							<span className="min-w-0 break-words">{task.content}</span>
						</li>
					);
				})}
			</ol>
		</SidebarGroup>
	);
}

/** omp's numbered diff lines: `+12|added`, `-12|removed`, ` 12|context`, with blank lines between hunks. */
function Diff({ diff }: { diff: string }) {
	return (
		<pre className="mx-2 mt-1 mb-2 max-h-80 overflow-auto rounded-md border border-border bg-muted/40 py-1 font-mono text-[11px] leading-4">
			{diff.split("\n").map((line, index) => (
				<span
					key={index}
					className={cn(
						"block px-2 whitespace-pre",
						line.startsWith("+") ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : line.startsWith("-") ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-muted-foreground",
					)}
				>
					{line || " "}
				</span>
			))}
		</pre>
	);
}

function FileRow({ file }: { file: ChangedFile }) {
	const [open, setOpen] = useState(false);
	const slash = file.path.lastIndexOf("/");
	const name = file.path.slice(slash + 1);
	const dir = slash > 0 ? file.path.slice(0, slash) : "";
	const edits = `${file.edits} ${file.edits === 1 ? "change" : "changes"}`;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton aria-expanded={open} title={`${file.path}\n${edits}`} onClick={() => setOpen(!open)} className="h-auto min-h-8 py-1">
				<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
					<span className="shrink-0 truncate text-foreground">{name}</span>
					{dir && <span className="truncate text-xs text-muted-foreground">{dir}</span>}
				</span>
			</SidebarMenuButton>
			<SidebarMenuBadge aria-label={edits}>{file.edits}</SidebarMenuBadge>
			{open &&
				(file.diff ? (
					<Diff diff={file.diff} />
				) : (
					<p className="px-4 pb-2 text-xs text-muted-foreground">Written whole, so omp recorded no diff.</p>
				))}
		</SidebarMenuItem>
	);
}

/** The right sidebar's content: the focused view's latest todo list, then the files its agent changed. */
export function PlanPanel({ view }: { view: View }) {
	const { work } = usePane(view);
	const empty = work !== null && work.phases.length === 0 && work.files.length === 0;
	return (
		<>
			<SidebarHeader className="flex-row items-center gap-2 px-3 pt-4">
				<h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Plan and changes</h2>
			</SidebarHeader>
			<SidebarContent>
				{empty && <p className="px-4 py-2 text-sm text-muted-foreground">No plan or file changes yet.</p>}
				{work?.phases.map((phase, index) => <Phase key={`${index}:${phase.name}`} phase={phase} />)}
				{work && work.files.length > 0 && (
					<SidebarGroup>
						<SidebarGroupLabel>
							{work.files.length} {work.files.length === 1 ? "file" : "files"} changed
						</SidebarGroupLabel>
						<SidebarMenu aria-label="Files changed">
							{work.files.map(file => (
								<FileRow key={file.path} file={file} />
							))}
						</SidebarMenu>
					</SidebarGroup>
				)}
			</SidebarContent>
		</>
	);
}
