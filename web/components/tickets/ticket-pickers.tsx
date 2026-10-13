/** The pickers for a Linear issue's status, priority, assignee, labels, and project, shared by the issue's side column and the new-issue dialog. */
import { Box, CircleUser, Tag } from "lucide-react";
import type { TicketChoice, TicketLabel, TicketOptions, TicketPriority, TicketStatus } from "../../../src/shared/tickets";
import { cn } from "@/lib/utils";
import { PRIORITY_LABEL, statusOrder } from "../../tickets-model";
import { FieldPicker, type PickerLook } from "../field-picker";
import { LabelDot, PRIORITY_ICON, statusIcon, TicketChip } from "./ticket-row";

const PRIORITIES: TicketPriority[] = [0, 1, 2, 3, 4];

/** What each picker that offers the team's choices takes: they read `options` once a click opens them. */
interface TeamPickerProps {
	/** A row of the side column, or a pill in the new-issue dialog. */
	look: PickerLook;
	/** The team's choices, `null` until they arrive or when they failed to, with `error`. */
	options: TicketOptions | null;
	error: string | null;
	disabled: boolean;
	/** A click opened the list: the owner reads the choices then, or again after they failed. */
	onOpen: () => void;
}

const iconSize = (look: PickerLook): string => (look === "chip" ? "size-3.5" : "size-4");

/** The workflow status, `null` while it is the team's default and not yet known. */
export function TicketStatusPicker({ look, value, options, error, disabled, onOpen, onChange }: TeamPickerProps & { value: TicketStatus | null; onChange: (status: TicketStatus) => void }) {
	const [Icon, color] = statusIcon(value ?? { status: "Backlog", statusType: "backlog" });
	return (
		<FieldPicker
			look={look}
			field="Status"
			current={value?.status ?? "team's default"}
			trigger={
				<>
					<Icon aria-hidden className={cn(iconSize(look), color)} />
					<span className="truncate">{value?.status ?? "Status"}</span>
				</>
			}
			choices={
				options?.statuses.toSorted(statusOrder).map(status => {
					const [StatusIcon, statusColor] = statusIcon(status);
					return { value: status.status, label: status.status, icon: <StatusIcon aria-hidden className={statusColor} /> };
				}) ?? null
			}
			error={error}
			selected={value ? [value.status] : []}
			disabled={disabled}
			onOpen={onOpen}
			onPick={name => {
				const status = options?.statuses.find(candidate => candidate.status === name);
				if (status && status.status !== value?.status) onChange(status);
			}}
		/>
	);
}

/** The priority; as a pill, no priority reads as the field's name. */
export function TicketPriorityPicker({ look, value, disabled, onChange }: { look: PickerLook; value: TicketPriority; disabled: boolean; onChange: (priority: TicketPriority) => void }) {
	const [Icon, color] = PRIORITY_ICON[value];
	return (
		<FieldPicker
			look={look}
			field="Priority"
			current={PRIORITY_LABEL[value]}
			trigger={
				<>
					<Icon aria-hidden className={cn(iconSize(look), color)} />
					<span className="truncate">{look === "chip" && value === 0 ? "Priority" : PRIORITY_LABEL[value]}</span>
				</>
			}
			choices={PRIORITIES.map(priority => {
				const [PriorityIcon, priorityColor] = PRIORITY_ICON[priority];
				return { value: String(priority), label: PRIORITY_LABEL[priority], icon: <PriorityIcon aria-hidden className={priorityColor} /> };
			})}
			selected={[String(value)]}
			disabled={disabled}
			onPick={picked => {
				const priority = PRIORITIES.find(candidate => String(candidate) === picked);
				if (priority !== undefined && priority !== value) onChange(priority);
			}}
		/>
	);
}

/** Who the issue is assigned to: `null` for no one, `"me"` for the viewer when `offerMe`, `undefined` while not known. */
export function TicketAssigneePicker({ look, value, offerMe = false, options, error, disabled, onOpen, onChange }: TeamPickerProps & { value: TicketChoice | "me" | null | undefined; offerMe?: boolean; onChange: (assignee: TicketChoice | "me" | null) => void }) {
	const name = value === "me" ? "Me" : value?.name;
	const selected = value === "me" ? "me" : (value?.id ?? "");
	return (
		<FieldPicker
			look={look}
			field="Assignee"
			current={value === undefined ? "loading" : (name ?? "unassigned")}
			trigger={
				<>
					<CircleUser aria-hidden className={cn(iconSize(look), "text-muted-foreground")} />
					<span className="truncate">{name ?? (look === "chip" || value === undefined ? "Assignee" : "Unassigned")}</span>
				</>
			}
			choices={options ? [...(offerMe ? [{ value: "me", label: "Me" }] : []), { value: "", label: "No assignee" }, ...options.users.map(user => ({ value: user.id, label: user.name }))] : null}
			error={error}
			selected={[selected]}
			disabled={disabled}
			onOpen={onOpen}
			onPick={id => {
				if (id === selected) return;
				onChange(id === "me" ? "me" : (options?.users.find(user => user.id === id) ?? null));
			}}
		/>
	);
}

/** The labels, toggled one at a time with the list left open. */
export function TicketLabelsPicker({ look, value, options, error, disabled, onOpen, onChange }: TeamPickerProps & { value: TicketLabel[]; onChange: (labels: TicketLabel[]) => void }) {
	const names = value.map(label => label.name);
	return (
		<FieldPicker
			look={look}
			field="Labels"
			current={names.join(", ") || "none"}
			trigger={
				look === "chip" ? (
					<>
						{value.length > 0 ? (
							<span className="flex items-center -space-x-0.5">
								{value.map(label => (
									<LabelDot key={label.name} color={label.color} />
								))}
							</span>
						) : (
							<Tag aria-hidden className="size-3.5 text-muted-foreground" />
						)}
						<span className="truncate">{value.length === 0 ? "Labels" : value.length === 1 ? names[0] : `${value.length} labels`}</span>
					</>
				) : value.length > 0 ? (
					<span className="flex min-w-0 flex-wrap gap-1.5">
						{value.map(({ name, color }) => (
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
			choices={options?.labels.map(label => ({ value: label.name, label: label.name, icon: <LabelDot color={label.color} /> })) ?? null}
			error={error}
			selected={names}
			multi
			disabled={disabled}
			onOpen={onOpen}
			onPick={name =>
				onChange(names.includes(name) ? value.filter(label => label.name !== name) : [...value, options?.labels.find(label => label.name === name) ?? { name, color: "" }])
			}
		/>
	);
}

/** The project, `null` for none. */
export function TicketProjectPicker({ look, value, options, error, disabled, onOpen, onChange }: TeamPickerProps & { value: string | null; onChange: (project: string | null) => void }) {
	return (
		<FieldPicker
			look={look}
			field="Project"
			current={value ?? "none"}
			trigger={
				<>
					<Box aria-hidden className={cn(iconSize(look), "text-muted-foreground")} />
					<span className={cn("truncate", look !== "chip" && !value && "text-muted-foreground")}>{value ?? (look === "chip" ? "Project" : "Add to project")}</span>
				</>
			}
			choices={options ? [{ value: "", label: "No project" }, ...options.projects.map(name => ({ value: name, label: name }))] : null}
			error={error}
			selected={[value ?? ""]}
			disabled={disabled}
			onOpen={onOpen}
			onPick={name => {
				if (name !== (value ?? "")) onChange(name || null);
			}}
		/>
	);
}
