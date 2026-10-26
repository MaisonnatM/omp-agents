/** `TicketFields`: a Linear issue's status, priority, assignee, due date, labels, and project pickers. */
import { Box, Calendar, CircleDashed, CircleUser, SignalHigh, Tag } from "lucide-react";
import { useState } from "react";
import type { Ticket, TicketDetail, TicketFieldValues, TicketOptions } from "../../../src/shared/tickets";
import { putJson } from "../../api";
import type { Editable } from "../../editable-read";
import { ticketsStore, useRead } from "../../reads";
import { DuePicker } from "../field-picker";
import { MetaRow } from "../sheet-details";
import { TicketAssigneePicker, TicketLabelsPicker, TicketPriorityPicker, TicketProjectPicker, TicketStatusPicker } from "./ticket-pickers";


interface TicketFieldsProps {
	/** What the fields show: the issue as the list has it, then in full once `detail` arrives. */
	ticket: Ticket;
	/** Linear's answer for the issue; the pickers change nothing until it arrives. */
	detail: TicketDetail | null;
	edit: Editable<TicketDetail>["edit"];
	/** Why Linear refused the last change. */
	saveError: string | null;
}

/**
 * The issue's status, priority, assignee, due date, labels, and project as property rows, each a picker that
 * changes it in Linear. A change shows at once and is sent in turn after the ones before it; when Linear refuses one,
 * it is undone, and the details name why.
 */
export function TicketFields({ ticket, detail, edit, saveError }: TicketFieldsProps) {
	const [opened, setOpened] = useState(false);
	const [retry, setRetry] = useState(0);
	const options = useRead<TicketOptions>(opened && detail ? `/api/ticket/options?${new URLSearchParams({ team: detail.teamId })}` : null, retry);

	const open = (): void => {
		setOpened(true);
		if (options.error) setRetry(count => count + 1);
	};

	const save = (change: TicketFieldValues, shown: Partial<TicketDetail>): void => {
		if (!detail) return;
		edit(shown, async () => {
			const answer = await putJson<TicketDetail>("/api/ticket", { id: detail.id, ...change });
			void ticketsStore.refresh();
			return answer;
		});
	};

	const team = { look: "row", options: options.data ?? null, error: options.error ?? null, disabled: !detail, onOpen: open } as const;

	return (
		<section className="space-y-2" aria-label="Issue properties">
			{saveError && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Linear did not take the change: {saveError}
				</p>
			)}
			<MetaRow icon={CircleDashed} label="Status">
				<TicketStatusPicker {...team} value={ticket} onChange={status => save({ state: status.status }, status)} />
			</MetaRow>
			<MetaRow icon={SignalHigh} label="Priority">
				<TicketPriorityPicker look="row" value={ticket.priority} disabled={!detail} onChange={priority => save({ priority }, { priority })} />
			</MetaRow>
			<MetaRow icon={CircleUser} label="Assignee">
				<TicketAssigneePicker
					{...team}
					value={detail ? detail.assignee : undefined}
					onChange={assignee => {
						if (assignee !== "me") save({ assignee: assignee?.id ?? null }, { assignee });
					}}
				/>
			</MetaRow>
			<MetaRow icon={Calendar} label="Due">
				<DuePicker look="row" dueDate={ticket.dueDate} disabled={!detail} onChange={dueDate => save({ dueDate }, { dueDate })} />
			</MetaRow>
			<MetaRow icon={Tag} label="Labels">
				<TicketLabelsPicker {...team} value={ticket.labels} onChange={labels => save({ labels: labels.map(label => label.name) }, { labels })} />
			</MetaRow>
			<MetaRow icon={Box} label="Project">
				<TicketProjectPicker {...team} value={ticket.project} onChange={project => save({ project }, { project })} />
			</MetaRow>
		</section>
	);
}
