import {
	Bot,
	Circle,
	CircleAlert,
	CircleCheck,
	CircleDot,
	CircleSlash,
	FileDiff,
	FileMinus,
	FilePen,
	FilePlus,
	Images,
	ListTodo,
	type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	type ChangedFile,
	type FileChange,
	type FileChangeKind,
	type FileStatus,
	fileStatus,
	lineTotals,
	type PlanDocument,
	parseDiffLine,
	type RosterHost,
	type TodoPhase,
	type TodoStatus,
	type View,
} from "../../src/shared";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { age, readTime } from "../labels";
import { usePane } from "../pane-store";
import { useStoredState } from "../stored-state";
import { AgentsTab } from "./agents-tab";
import { MediaTab } from "./media-tab";
import { MessageMarkdown } from "./message-markdown";

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

/** The plan file the agent wrote or edited last, as markdown under its file name. */
function PlanFile({ plan }: { plan: PlanDocument }) {
	const name = plan.path.slice(plan.path.lastIndexOf("/") + 1);
	return (
		<SidebarGroup>
			<SidebarGroupLabel title={plan.path}>
				<span className="min-w-0 flex-1 truncate">{name}</span>
			</SidebarGroupLabel>
			<article className="px-4 pb-2 text-sm leading-relaxed" aria-label={name}>
				<MessageMarkdown text={plan.text} />
			</article>
		</SidebarGroup>
	);
}

const CHANGE_LABEL: Record<FileChangeKind, string> = { created: "Created", edited: "Edited", rewritten: "Rewritten", deleted: "Deleted" };

/** omp's numbered diff, `+12|added`, `-12|removed`, ` 12|context`, with blank lines between hunks, in the flow of the list. */
function Diff({ diff }: { diff: string }) {
	return (
		<div className="font-mono text-[11px] leading-4" data-diff>
			{diff.split("\n").map((line, index) => {
				const parsed = parseDiffLine(line);
				if (!parsed) return <div key={index} className="h-2" aria-hidden />;
				const { sign, number, text } = parsed;
				return (
					<div
						key={index}
						className={cn(
							"flex",
							sign === "+" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : sign === "-" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "text-muted-foreground",
						)}
					>
						<span className="w-10 shrink-0 pr-1.5 text-right opacity-60 select-none">{number}</span>
						<span className="w-3 shrink-0 select-none">{sign}</span>
						<span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{text || " "}</span>
					</div>
				);
			})}
		</div>
	);
}

/** `+12 −3`, the lines added and removed. */
function LineCounts({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="shrink-0 whitespace-nowrap tabular-nums" aria-label={`${added} added, ${removed} removed`}>
			<span className="text-emerald-600 dark:text-emerald-400">+{added}</span> <span className="text-red-600 dark:text-red-400">−{removed}</span>
		</span>
	);
}

const lines = (count: number): string => `${count} ${count === 1 ? "line" : "lines"}`;

/** A change's kind and time, then what it recorded: an edit's line counts and diff, or how many lines a write wrote. */
function Change({ change }: { change: FileChange }) {
	let counts: ReactNode;
	let body: ReactNode;
	switch (change.tool) {
		case "edit":
			counts = <LineCounts added={change.added} removed={change.removed} />;
			body = change.diff && <Diff diff={change.diff} />;
			break;
		case "write":
			counts = change.lines !== null && <span className="tabular-nums">{lines(change.lines)}</span>;
			body = <p className="text-xs text-muted-foreground">Written whole, so omp recorded no diff.</p>;
			break;
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
	return (
		<li className="space-y-1">
			<p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">{CHANGE_LABEL[change.kind]}</span>
				{change.at !== null && <time dateTime={new Date(change.at).toISOString()}>{readTime(change.at)}</time>}
				<span className="flex-1" />
				{counts}
			</p>
			{body}
		</li>
	);
}

const FILE_LOOK: Record<FileStatus, { icon: LucideIcon; label: string }> = {
	created: { icon: FilePlus, label: "New file" },
	edited: { icon: FilePen, label: "Edited" },
	deleted: { icon: FileMinus, label: "Deleted" },
};

function FileRow({ file }: { file: ChangedFile }) {
	const [open, setOpen] = useState(false);
	const slash = file.path.lastIndexOf("/");
	const name = file.path.slice(slash + 1);
	const dir = slash > 0 ? file.path.slice(0, slash) : "";
	const { changes } = file;
	const look = FILE_LOOK[fileStatus(changes)];
	const last = changes[changes.length - 1].at;
	const summary = [look.label, `${changes.length} ${changes.length === 1 ? "change" : "changes"}`, last !== null && `${age(last)} ago`].filter(Boolean).join(" · ");
	return (
		<SidebarMenuItem>
			<SidebarMenuButton icon={look.icon} aria-expanded={open} title={`${file.path}\n${summary}`} onClick={() => setOpen(!open)} className="h-auto min-h-8 items-start py-1.5 [&>svg]:mt-0.5">
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<span className="min-w-0 truncate text-foreground">{name}</span>
						<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
						<span className="text-xs">
							<LineCounts {...lineTotals(changes)} />
						</span>
					</span>
					<span className="truncate text-xs text-muted-foreground">{summary}</span>
				</span>
			</SidebarMenuButton>
			{open && (
				<ol className="space-y-3 border-l border-border py-2 pr-1 pl-3 ml-4" aria-label={`Changes to ${file.path}, newest first`}>
					{changes.toReversed().map((change, index) => (
						<Change key={changes.length - index} change={change} />
					))}
				</ol>
			)}
		</SidebarMenuItem>
	);
}

/** The right sidebar's tab, which localStorage keeps across views. */
const TAB_KEY = "omp-agents.plan-tab";

const PLAN_TABS = ["plan", "files", "agents", "media"] as const;
type PlanTab = (typeof PLAN_TABS)[number];

/** Four labeled tabs overflow the sidebar's default width, so each shows its icon and its count, and names itself on hover and to screen readers. */
function tabLabel(name: string, count: number): { label: string; "aria-label": string; title: string } {
	return { label: count > 0 ? String(count) : "", "aria-label": count > 0 ? `${name} (${count})` : name, title: name };
}

/**
 * The right sidebar's content for the focused view: its latest todo list and plan file, the files its agent changed,
 * a live session's agents, and the images its agents' tools returned, each tab apart.
 */
export function PlanPanel({ view, host }: { view: View; host: RosterHost | null }) {
	const { work, media } = usePane(view);
	const [stored, setTab] = useStoredState<PlanTab>(TAB_KEY, raw => PLAN_TABS.find(tab => tab === raw) ?? "plan");
	// A past session's subagents have no view to open, so it has no Agents tab.
	const tab = stored === "agents" && view.kind !== "live" ? "plan" : stored;
	const files = work?.files ?? [];
	return (
		<Tabs value={tab} onValueChange={value => setTab(value as PlanTab)} className="flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="flex-row items-center gap-2 px-2 pt-4">
				<h2 className="sr-only">Session details</h2>
				<SizeProvider size="compact">
					<TabsList aria-label="Session details">
						<TabItem value="plan" icon={ListTodo} {...tabLabel("Plan", 0)} />
						<TabItem value="files" icon={FileDiff} {...tabLabel("Files", files.length)} />
						{view.kind === "live" && <TabItem value="agents" icon={Bot} {...tabLabel("Agents", host?.agents.length ?? 0)} />}
						<TabItem value="media" icon={Images} {...tabLabel("Media", media?.length ?? 0)} />
					</TabsList>
				</SizeProvider>
			</SidebarHeader>
			<TabPanel value="plan" asChild>
				<SidebarContent>
					{work && work.phases.length === 0 && !work.plan && <p className="px-4 py-2 text-sm text-muted-foreground">No plan yet.</p>}
					{work?.phases.map((phase, index) => <Phase key={`${index}:${phase.name}`} phase={phase} />)}
					{work?.plan && <PlanFile plan={work.plan} />}
				</SidebarContent>
			</TabPanel>
			<TabPanel value="files" asChild>
				<SidebarContent>
					{work && files.length === 0 && <p className="px-4 py-2 text-sm text-muted-foreground">No file changes yet.</p>}
					{files.length > 0 && (
						<SidebarGroup>
							<SidebarGroupLabel>
								<span className="min-w-0 flex-1 truncate">
									{files.length} {files.length === 1 ? "file" : "files"} changed
								</span>
								<LineCounts {...lineTotals(files.flatMap(file => file.changes))} />
							</SidebarGroupLabel>
							<SidebarMenu aria-label="Files changed">
								{files.map(file => (
									<FileRow key={file.path} file={file} />
								))}
							</SidebarMenu>
						</SidebarGroup>
					)}
				</SidebarContent>
			</TabPanel>
			{view.kind === "live" && (
				<TabPanel value="agents" asChild>
					<SidebarContent>
						<AgentsTab view={view} host={host} />
					</SidebarContent>
				</TabPanel>
			)}
			<TabPanel value="media" asChild>
				<SidebarContent>
					<MediaTab media={media} view={view} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
