import { Box, Calendar, Check, CircleUser, Tag } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { TicketDetail, TicketEdit, TicketOptions, TicketPriority } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getJson, putJson } from "../../api";
import { ticketsStore } from "../../reads";
import { PRIORITY_LABEL } from "../../tickets-model";
import { dueLabel, PRIORITY_ICON, STATUS_ICON } from "./ticket-row";

type Change = Omit<TicketEdit, "id">;

const PRIORITIES: TicketPriority[] = [0, 1, 2, 3, 4];

/** Each team's options, shared across issue details; a failed read is tried again on the next opening. */
const optionReads = new Map<string, Promise<TicketOptions>>();

function readOptions(team: string): Promise<TicketOptions> {
	let read = optionReads.get(team);
	if (!read) {
		read = getJson<TicketOptions>(`/api/ticket/options?${new URLSearchParams({ team })}`);
		optionReads.set(team, read);
		read.catch(() => optionReads.delete(team));
	}
	return read;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface Choice {
	value: string;
	label: string;
	icon?: ReactNode;
}

interface FieldPickerProps {
	/** What the field is, for the search box and screen readers: `Status`. */
	field: string;
	/** What the field holds now, in words, for screen readers. */
	current: string;
	trigger: ReactNode;
	/** `null` while Linear's options load, or when they failed to, with `error`. */
	choices: Choice[] | null;
	error?: string | null;
	selected: string[];
	/** Several choices at once: the list stays open while the choices toggle. */
	multi?: boolean;
	onOpen?: () => void;
	onPick: (value: string) => void;
}

/** A header field as a button that opens a searchable list of its choices, as Linear's issue fields do. */
function FieldPicker({ field, current, trigger, choices, error = null, selected, multi = false, onOpen, onPick }: FieldPickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover
			open={open}
			onOpenChange={next => {
				setOpen(next);
				if (next) onOpen?.();
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" className="max-w-56 px-1.5 text-muted-foreground" aria-label={`${field}: ${current}`} active={open}>
					<span className="flex min-w-0 items-center gap-1">{trigger}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 p-0">
				<Command>
					<CommandInput aria-label={`Search ${field.toLowerCase()}`} placeholder={`${field}…`} />
					<CommandList>
						{choices === null ? (
							<p role={error ? "alert" : undefined} className={cn("px-3 py-2 text-xs", error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
								{error ?? "Asking Linear…"}
							</p>
						) : (
							<>
								<CommandEmpty>No match.</CommandEmpty>
								<CommandGroup>
									{choices.map(choice => (
										<CommandItem
											key={choice.value}
											value={choice.value}
											keywords={[choice.label]}
											onSelect={() => {
												if (!multi) setOpen(false);
												onPick(choice.value);
											}}
										>
											{choice.icon}
											<span className="truncate">{choice.label}</span>
											<Check aria-hidden className={cn("ml-auto", selected.includes(choice.value) ? "opacity-100" : "opacity-0")} />
										</CommandItem>
									))}
								</CommandGroup>
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/** The due date: a date field to set it, and a button to clear it. */
function DuePicker({ dueDate, onChange }: { dueDate: string | null; onChange: (dueDate: string | null) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" className="px-1.5 text-muted-foreground" leadingIcon={Calendar} aria-label={`Due date: ${dueDate ?? "none"}`} active={open}>
					{dueDate ? dueLabel(dueDate) : "Due date"}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-2">
				<form
					onSubmit={event => {
						event.preventDefault();
						const value = new FormData(event.currentTarget).get("due");
						setOpen(false);
						if (typeof value === "string" && value !== "" && value !== dueDate) onChange(value);
					}}
					className="flex items-center gap-1.5"
				>
					<input
						type="date"
						name="due"
						aria-label="Due date"
						defaultValue={dueDate ?? ""}
						required
						className="h-7 rounded-md border border-border bg-background px-2 text-xs"
					/>
					<Button type="submit" variant="secondary" size="compact">
						Set
					</Button>
					{dueDate && (
						<Button
							type="button"
							variant="ghost"
							size="compact"
							onClick={() => {
								setOpen(false);
								onChange(null);
							}}
						>
							Clear
						</Button>
					)}
				</form>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The issue's status, priority, assignee, project, due date, and labels, each a picker that changes it in Linear. A
 * change shows at once and is sent in turn after the ones before it; when Linear refuses it, the detail view reads the issue
 * again and names why.
 */
export function TicketFields({ detail, replace }: { detail: TicketDetail; replace: (detail: TicketDetail) => void }) {
	const [options, setOptions] = useState<TicketOptions | null>(null);
	const [optionsError, setOptionsError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const queue = useRef<Promise<unknown>>(Promise.resolve());

	const loadOptions = (): void => {
		if (options || !detail.teamId) return;
		setOptionsError(null);
		readOptions(detail.teamId).then(setOptions, (err: unknown) => setOptionsError(messageOf(err)));
	};

	const save = (change: Change, shown: Partial<TicketDetail>): void => {
		replace({ ...detail, ...shown });
		setSaveError(null);
		queue.current = queue.current.then(() =>
			putJson<TicketDetail>("/api/ticket", { id: detail.id, ...change }).then(
				after => {
					replace(after);
					void ticketsStore.refresh();
				},
				async (err: unknown) => {
					setSaveError(messageOf(err));
					await getJson<TicketDetail>(`/api/ticket?${new URLSearchParams({ id: detail.id })}`).then(replace, () => {});
				},
			),
		);
	};

	const [StatusIcon, statusColor] = STATUS_ICON[detail.statusType];
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[detail.priority];
	const statusId = options?.statuses.find(status => status.name === detail.status)?.id;
	const projectId = options?.projects.find(project => project.name === detail.project)?.id;

	return (
		<>
			<div className="-ml-1.5 flex flex-wrap items-center gap-0.5 text-xs">
				<FieldPicker
					field="Status"
					current={detail.status}
					trigger={
						<>
							<StatusIcon aria-hidden className={cn("size-3.5", statusColor)} />
							<span className="truncate">{detail.status}</span>
						</>
					}
					choices={
						options?.statuses.map(status => {
							const [Icon, color] = STATUS_ICON[status.type];
							return { value: status.id, label: status.name, icon: <Icon aria-hidden className={color} /> };
						}) ?? null
					}
					error={optionsError}
					selected={statusId ? [statusId] : []}
					onOpen={loadOptions}
					onPick={id => {
						const status = options?.statuses.find(candidate => candidate.id === id);
						if (status && status.name !== detail.status) save({ state: id }, { status: status.name, statusType: status.type });
					}}
				/>
				<FieldPicker
					field="Priority"
					current={PRIORITY_LABEL[detail.priority]}
					trigger={
						<>
							<PriorityIcon aria-hidden className={cn("size-3.5", priorityColor)} />
							<span className="truncate">{PRIORITY_LABEL[detail.priority]}</span>
						</>
					}
					choices={PRIORITIES.map(priority => {
						const [Icon, color] = PRIORITY_ICON[priority];
						return { value: String(priority), label: PRIORITY_LABEL[priority], icon: <Icon aria-hidden className={color} /> };
					})}
					selected={[String(detail.priority)]}
					onPick={value => {
						const priority = PRIORITIES.find(candidate => String(candidate) === value);
						if (priority !== undefined && priority !== detail.priority) save({ priority }, { priority });
					}}
				/>
				<FieldPicker
					field="Assignee"
					current={detail.assignee?.name ?? "unassigned"}
					trigger={
						<>
							<CircleUser aria-hidden className="size-3.5" />
							<span className="truncate">{detail.assignee?.name ?? "Unassigned"}</span>
						</>
					}
					choices={options ? [{ value: "", label: "No assignee" }, ...options.users.map(user => ({ value: user.id, label: user.name }))] : null}
					error={optionsError}
					selected={[detail.assignee?.id ?? ""]}
					onOpen={loadOptions}
					onPick={id => {
						if (id === (detail.assignee?.id ?? "")) return;
						const user = options?.users.find(candidate => candidate.id === id) ?? null;
						save({ assignee: user?.id ?? null }, { assignee: user });
					}}
				/>
				<FieldPicker
					field="Project"
					current={detail.project ?? "none"}
					trigger={
						<>
							<Box aria-hidden className="size-3.5" />
							<span className="truncate">{detail.project ?? "No project"}</span>
						</>
					}
					choices={options ? [{ value: "", label: "No project" }, ...options.projects.map(project => ({ value: project.id, label: project.name }))] : null}
					error={optionsError}
					selected={detail.project === null ? [""] : projectId ? [projectId] : []}
					onOpen={loadOptions}
					onPick={id => {
						if (id === (detail.project === null ? "" : projectId)) return;
						const project = options?.projects.find(candidate => candidate.id === id) ?? null;
						save({ project: project?.id ?? null }, { project: project?.name ?? null });
					}}
				/>
				<DuePicker dueDate={detail.dueDate} onChange={dueDate => save({ dueDate }, { dueDate })} />
				<FieldPicker
					field="Labels"
					current={detail.labels.join(", ") || "none"}
					trigger={
						<>
							<Tag aria-hidden className="size-3.5" />
							<span className="truncate">{detail.labels.join(", ") || "Labels"}</span>
						</>
					}
					choices={
						options?.labels.map(label => ({
							value: label.name,
							label: label.name,
							icon: <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color || "currentColor" }} />,
						})) ?? null
					}
					error={optionsError}
					selected={detail.labels}
					multi
					onOpen={loadOptions}
					onPick={name => {
						const labels = detail.labels.includes(name) ? detail.labels.filter(label => label !== name) : [...detail.labels, name];
						save({ labels }, { labels });
					}}
				/>
			</div>
			{saveError && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Linear did not take the change: {saveError}
				</p>
			)}
		</>
	);
}
