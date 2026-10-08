import { Box, CircleUser, Tag } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Ticket, TicketDetail, TicketFieldValues, TicketOptions, TicketPriority } from "../../../src/shared/tickets";
import { cn } from "@/lib/utils";
import { putJson } from "../../api";
import { ticketsStore, useRead } from "../../reads";
import { PRIORITY_LABEL, statusOrder } from "../../tickets-model";
import { useQueuedSave } from "../../use-queued-save";
import { DuePicker, FieldPicker } from "../field-picker";
import { DetailSection } from "../sheet-details";
import { LabelDot, PRIORITY_ICON, statusIcon, TicketChip } from "./ticket-row";

export const PRIORITIES: TicketPriority[] = [0, 1, 2, 3, 4];


/** A titled group of fields in the side column, whose buttons line their icons up with the title. */
function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<DetailSection title={title}>
			<div className="-mx-2 flex flex-col">{children}</div>
		</DetailSection>
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
 * The issue's status, priority, assignee, due date, labels, and project in the side column, each a picker that
 * changes it in Linear. A change shows at once and is sent in turn after the ones before it; when Linear refuses one,
 * the issue is read again once every change sent has answered, and the page names why.
 */
export function TicketFields({ ticket, detail, replace, reload }: TicketFieldsProps) {
	const [opened, setOpened] = useState(false);
	const [retry, setRetry] = useState(0);
	const queued = useQueuedSave({ replace, reload, onSaved: () => void ticketsStore.refresh() });
	const options = useRead<TicketOptions>(opened && detail ? `/api/ticket/options?${new URLSearchParams({ team: detail.teamId })}` : null, retry);

	const open = (): void => {
		setOpened(true);
		if (options.error) setRetry(count => count + 1);
	};

	const save = (change: TicketFieldValues, shown: Partial<TicketDetail>): void => {
		if (detail) queued.save({ ...detail, ...shown }, () => putJson<TicketDetail>("/api/ticket", { id: detail.id, ...change }));
	};

	const [StatusIcon, statusColor] = statusIcon(ticket);
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[ticket.priority];
	const labelNames = ticket.labels.map(label => label.name);

	return (
		<>
			{queued.error && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Linear did not take the change: {queued.error}
				</p>
			)}
			<FieldGroup title="Properties">
				<FieldPicker
					field="Status"
					current={ticket.status}
					trigger={
						<>
							<StatusIcon aria-hidden className={cn("size-4", statusColor)} />
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
							<PriorityIcon aria-hidden className={cn("size-4", priorityColor)} />
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
							<CircleUser aria-hidden className="size-4 text-muted-foreground" />
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
				<DuePicker dueDate={ticket.dueDate} disabled={!detail} onChange={dueDate => save({ dueDate }, { dueDate })} />
			</FieldGroup>
			<FieldGroup title="Labels">
				<FieldPicker
					field="Labels"
					current={labelNames.join(", ") || "none"}
					trigger={
						ticket.labels.length > 0 ? (
							<span className="flex min-w-0 flex-wrap gap-1.5">
								{ticket.labels.map(({ name, color }) => (
									<TicketChip key={name} icon={<LabelDot color={color} />} className="text-foreground">
										{name}
									</TicketChip>
								))}
							</span>
						) : (
							<>
								<Tag aria-hidden className="size-4 text-muted-foreground" />
								<span className="text-muted-foreground">Add label</span>
							</>
						)
					}
					choices={
						options.data?.labels.map(label => ({
							value: label.name,
							label: label.name,
							icon: <LabelDot color={label.color} />,
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
			</FieldGroup>
			<FieldGroup title="Project">
				<FieldPicker
					field="Project"
					current={ticket.project ?? "none"}
					trigger={
						<>
							<Box aria-hidden className="size-4 text-muted-foreground" />
							<span className={cn("truncate", !ticket.project && "text-muted-foreground")}>{ticket.project ?? "Add to project"}</span>
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
			</FieldGroup>
		</>
	);
}
