/** `TicketFields`: a Linear issue's status, priority, assignee, due date, labels, and project pickers. */
import { type ReactNode, useState } from "react";
import type { Ticket, TicketDetail, TicketFieldValues, TicketOptions } from "../../../src/shared/tickets";
import { putJson } from "../../api";
import { ticketsStore, useRead } from "../../reads";
import { useQueuedSave } from "../../use-queued-save";
import { DuePicker } from "../field-picker";
import { DetailSection } from "../sheet-details";
import { TicketAssigneePicker, TicketLabelsPicker, TicketPriorityPicker, TicketProjectPicker, TicketStatusPicker } from "./ticket-pickers";


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

	const team = { look: "field", options: options.data ?? null, error: options.error ?? null, disabled: !detail, onOpen: open } as const;

	return (
		<>
			{queued.error && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Linear did not take the change: {queued.error}
				</p>
			)}
			<FieldGroup title="Properties">
				<TicketStatusPicker {...team} value={ticket} onChange={status => save({ state: status.status }, status)} />
				<TicketPriorityPicker look="field" value={ticket.priority} disabled={!detail} onChange={priority => save({ priority }, { priority })} />
				<TicketAssigneePicker
					{...team}
					value={detail ? detail.assignee : undefined}
					onChange={assignee => {
						if (assignee !== "me") save({ assignee: assignee?.id ?? null }, { assignee });
					}}
				/>
				<DuePicker dueDate={ticket.dueDate} disabled={!detail} onChange={dueDate => save({ dueDate }, { dueDate })} />
			</FieldGroup>
			<FieldGroup title="Labels">
				<TicketLabelsPicker {...team} value={ticket.labels} onChange={labels => save({ labels: labels.map(label => label.name) }, { labels })} />
			</FieldGroup>
			<FieldGroup title="Project">
				<TicketProjectPicker {...team} value={ticket.project} onChange={project => save({ project }, { project })} />
			</FieldGroup>
		</>
	);
}
