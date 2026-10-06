import { Box, Calendar, Check, CircleUser, Tag } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { Ticket, TicketDetail, TicketEdit, TicketOptions, TicketPriority } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { ticketsStore, useRead } from "../../reads";
import { PRIORITY_LABEL, statusOrder } from "../../tickets-model";
import { dueLabel, PRIORITY_ICON, statusIcon } from "./ticket-row";

type Change = Omit<TicketEdit, "id">;

const PRIORITIES: TicketPriority[] = [0, 1, 2, 3, 4];

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
	/** The field cannot change yet: Linear has not answered for the issue. */
	disabled?: boolean;
	onOpen?: () => void;
	onPick: (value: string) => void;
}

/** A header field as a button that opens a searchable list of its choices, as Linear's issue fields do. */
function FieldPicker({ field, current, trigger, choices, error = null, selected, multi = false, disabled = false, onOpen, onPick }: FieldPickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover
			open={open}
			onOpenChange={next => {
				setOpen(next);
				if (next) onOpen?.();
			}}
		>
			<Tooltip content={`Change ${field.toLowerCase()}: ${current}`} side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="compact" className="max-w-56 px-1.5 text-muted-foreground" aria-label={`${field}: ${current}`} data-state={open ? "open" : "closed"} active={open} disabled={disabled}>
						<span className="flex min-w-0 items-center gap-1">{trigger}</span>
					</Button>
				</PopoverTrigger>
			</Tooltip>
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
function DuePicker({ dueDate, disabled, onChange }: { dueDate: string | null; disabled: boolean; onChange: (dueDate: string | null) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content={dueDate ? `Change the due date: ${dueLabel(dueDate)}` : "Set a due date"} side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="compact" className="px-1.5 text-muted-foreground" leadingIcon={Calendar} aria-label={`Due date: ${dueDate ?? "none"}`} data-state={open ? "open" : "closed"} active={open} disabled={disabled}>
						{dueDate ? dueLabel(dueDate) : "Due date"}
					</Button>
				</PopoverTrigger>
			</Tooltip>
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

interface TicketFieldsProps {
	/** What the fields show: the issue as the list has it, then in full once `detail` arrives. */
	ticket: Ticket;
	/** Linear's answer for the issue; the pickers change nothing until it arrives. */
	detail: TicketDetail | null;
	replace: (detail: TicketDetail) => void;
	/** Reads the issue again. */
	reload: () => void;
}

/**
 * The issue's status, priority, assignee, project, due date, and labels, each a picker that changes it in Linear. A
 * change shows at once and is sent in turn after the ones before it; when Linear refuses one, the issue is read again
 * once every change sent has answered, and the page names why.
 */
export function TicketFields({ ticket, detail, replace, reload }: TicketFieldsProps) {
	const [opened, setOpened] = useState(false);
	const [retry, setRetry] = useState(0);
	const [saveError, setSaveError] = useState<string | null>(null);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const unsent = useRef(0);
	const refused = useRef(false);
	const options = useRead<TicketOptions>(opened && detail ? `/api/ticket/options?${new URLSearchParams({ team: detail.teamId })}` : null, retry);

	const open = (): void => {
		setOpened(true);
		if (options.error) setRetry(count => count + 1);
	};

	const save = (change: Change, shown: Partial<TicketDetail>): void => {
		if (!detail) return;
		replace({ ...detail, ...shown });
		setSaveError(null);
		unsent.current++;
		queue.current = queue.current.then(() =>
			putJson<TicketDetail>("/api/ticket", { id: detail.id, ...change })
				.then(
					after => {
						replace(after);
						void ticketsStore.refresh();
					},
					(err: unknown) => {
						setSaveError(errorText(err));
						refused.current = true;
					},
				)
				.then(() => {
					if (--unsent.current > 0 || !refused.current) return;
					refused.current = false;
					reload();
				}),
		);
	};

	const [StatusIcon, statusColor] = statusIcon(ticket);
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[ticket.priority];
	const labelNames = ticket.labels.map(label => label.name);

	return (
		<>
			<div className="-ml-1.5 flex flex-wrap items-center gap-0.5 text-xs">
				<FieldPicker
					field="Status"
					current={ticket.status}
					trigger={
						<>
							<StatusIcon aria-hidden className={cn("size-3.5", statusColor)} />
							<span className="truncate">{ticket.status}</span>
						</>
					}
					choices={
						options.data?.statuses.toSorted(statusOrder).map(status => {
							const [Icon, color] = statusIcon(status);
							return { value: status.status, label: status.status, icon: <Icon aria-hidden className={color} /> };
						}) ?? null
					}
					error={options.error}
					selected={[ticket.status]}
					disabled={!detail}
					onOpen={open}
					onPick={name => {
						const status = options.data?.statuses.find(candidate => candidate.status === name);
						if (status && status.status !== ticket.status) save({ state: status.status }, status);
					}}
				/>
				<FieldPicker
					field="Priority"
					current={PRIORITY_LABEL[ticket.priority]}
					trigger={
						<>
							<PriorityIcon aria-hidden className={cn("size-3.5", priorityColor)} />
							<span className="truncate">{PRIORITY_LABEL[ticket.priority]}</span>
						</>
					}
					choices={PRIORITIES.map(priority => {
						const [Icon, color] = PRIORITY_ICON[priority];
						return { value: String(priority), label: PRIORITY_LABEL[priority], icon: <Icon aria-hidden className={color} /> };
					})}
					selected={[String(ticket.priority)]}
					disabled={!detail}
					onPick={value => {
						const priority = PRIORITIES.find(candidate => String(candidate) === value);
						if (priority !== undefined && priority !== ticket.priority) save({ priority }, { priority });
					}}
				/>
				<FieldPicker
					field="Assignee"
					current={detail ? (detail.assignee?.name ?? "unassigned") : "loading"}
					trigger={
						<>
							<CircleUser aria-hidden className="size-3.5" />
							<span className="truncate">{detail ? (detail.assignee?.name ?? "Unassigned") : "Assignee"}</span>
						</>
					}
					choices={options.data ? [{ value: "", label: "No assignee" }, ...options.data.users.map(user => ({ value: user.id, label: user.name }))] : null}
					error={options.error}
					selected={[detail?.assignee?.id ?? ""]}
					disabled={!detail}
					onOpen={open}
					onPick={id => {
						if (!detail || id === (detail.assignee?.id ?? "")) return;
						const user = options.data?.users.find(candidate => candidate.id === id) ?? null;
						save({ assignee: user?.id ?? null }, { assignee: user });
					}}
				/>
				<FieldPicker
					field="Project"
					current={ticket.project ?? "none"}
					trigger={
						<>
							<Box aria-hidden className="size-3.5" />
							<span className="truncate">{ticket.project ?? "No project"}</span>
						</>
					}
					choices={options.data ? [{ value: "", label: "No project" }, ...options.data.projects.map(name => ({ value: name, label: name }))] : null}
					error={options.error}
					selected={[ticket.project ?? ""]}
					disabled={!detail}
					onOpen={open}
					onPick={name => {
						if (name !== (ticket.project ?? "")) save({ project: name || null }, { project: name || null });
					}}
				/>
				<DuePicker dueDate={ticket.dueDate} disabled={!detail} onChange={dueDate => save({ dueDate }, { dueDate })} />
				<FieldPicker
					field="Labels"
					current={labelNames.join(", ") || "none"}
					trigger={
						<>
							{ticket.labels.length > 0 ? (
								<span aria-hidden className="flex shrink-0 -space-x-0.5">
									{ticket.labels.map(({ name, color }) => (
										<span key={name} className="size-2 rounded-full ring-1 ring-background" style={{ backgroundColor: color || "currentColor" }} />
									))}
								</span>
							) : (
								<Tag aria-hidden className="size-3.5" />
							)}
							<span className="truncate">{labelNames.join(", ") || "Labels"}</span>
						</>
					}
					choices={
						options.data?.labels.map(label => ({
							value: label.name,
							label: label.name,
							icon: <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color || "currentColor" }} />,
						})) ?? null
					}
					error={options.error}
					selected={labelNames}
					multi
					disabled={!detail}
					onOpen={open}
					onPick={name => {
						const labels = labelNames.includes(name)
							? ticket.labels.filter(label => label.name !== name)
							: [...ticket.labels, { name, color: options.data?.labels.find(label => label.name === name)?.color ?? "" }];
						save({ labels: labels.map(label => label.name) }, { labels });
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
