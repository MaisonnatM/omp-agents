/** A todo's status, priority, assignee, and due day as pickers, as an icon on its row or a labeled button in its details. */
import { BotMessageSquare, CalendarClock, CircleDashed, type LucideIcon, User } from "lucide-react";
import {
	TODO_ASSIGNEES,
	TODO_PRIORITIES,
	TODO_STATUSES,
	type TodoAssignee,
	type TodoPriority,
	type TodoStatus,
	type UserTodoChange,
	type UserTodoLeaf,
} from "../../../src/user-todos-shared";
import { cn } from "@/lib/utils";
import { PRIORITY_LABEL } from "../../tickets-model";
import { dueLabel, TODO_STATUS } from "../../todo-views";
import { type Choice, DuePicker, FieldPicker } from "../field-picker";
import { PRIORITY_ICON, STATUS_ICON } from "../tickets/ticket-row";

export function StatusIcon({ status, className }: { status: TodoStatus; className?: string }) {
	const [Icon, color] = STATUS_ICON[TODO_STATUS[status].kind];
	return <Icon aria-hidden className={cn("size-4 shrink-0", color, className)} />;
}

function PriorityIcon({ priority }: { priority: TodoPriority }) {
	const [Icon, color] = PRIORITY_ICON[priority];
	return <Icon aria-hidden className={cn("size-4 shrink-0", color)} />;
}

const ASSIGNEE: Record<TodoAssignee | "none", { label: string; icon: LucideIcon }> = {
	none: { label: "No assignee", icon: CircleDashed },
	user: { label: "You", icon: User },
	agent: { label: "Agent", icon: BotMessageSquare },
};

function AssigneeIcon({ assignee }: { assignee: TodoAssignee | null }) {
	const { icon: Icon } = ASSIGNEE[assignee ?? "none"];
	return <Icon aria-hidden className={cn("size-4 shrink-0", assignee === null && "text-muted-foreground")} />;
}

const STATUS_CHOICES: Choice[] = TODO_STATUSES.map(status => ({ value: status, label: TODO_STATUS[status].label, icon: <StatusIcon status={status} /> }));
const PRIORITY_CHOICES: Choice[] = TODO_PRIORITIES.map(priority => ({ value: String(priority), label: PRIORITY_LABEL[priority], icon: <PriorityIcon priority={priority} /> }));
const ASSIGNEE_CHOICES: Choice[] = [null, ...TODO_ASSIGNEES].map(assignee => ({ value: assignee ?? "", label: ASSIGNEE[assignee ?? "none"].label, icon: <AssigneeIcon assignee={assignee} /> }));

/** How a picker's button looks: a bare icon on a row, or a labeled button in the details' property row. */
export type FieldLook = "icon" | "property";

const BUTTON: Record<FieldLook, string> = {
	icon: "h-6 w-6 shrink-0 justify-center px-0",
	property: "h-7 shrink-0 justify-start border border-border px-2 text-[13px] font-normal text-foreground",
};

interface TodoFieldProps {
	todo: UserTodoLeaf;
	look: FieldLook;
	disabled: boolean;
	/** Whether the picker is open, when a key can open it. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onChange: (change: UserTodoChange) => void;
}

export function TodoStatusPicker({ todo, look, onChange, ...props }: TodoFieldProps) {
	const { label } = TODO_STATUS[todo.status];
	return (
		<FieldPicker
			{...props}
			field="Status"
			current={label}
			trigger={
				<>
					<StatusIcon status={todo.status} />
					{look === "property" && <span className="truncate">{label}</span>}
				</>
			}
			className={BUTTON[look]}
			choices={STATUS_CHOICES}
			selected={[todo.status]}
			firstKey={1}
			onPick={value => {
				const status = TODO_STATUSES.find(status => status === value);
				if (status && status !== todo.status) onChange({ op: "set-status", id: todo.id, status, at: new Date().toISOString() });
			}}
		/>
	);
}

export function TodoPriorityPicker({ todo, look, onChange, ...props }: TodoFieldProps) {
	const label = PRIORITY_LABEL[todo.priority];
	return (
		<FieldPicker
			{...props}
			field="Priority"
			current={label}
			trigger={
				<>
					<PriorityIcon priority={todo.priority} />
					{look === "property" && <span className={cn("truncate", todo.priority === 0 && "text-muted-foreground")}>{todo.priority === 0 ? "Priority" : label}</span>}
				</>
			}
			className={BUTTON[look]}
			choices={PRIORITY_CHOICES}
			selected={[String(todo.priority)]}
			firstKey={0}
			onPick={value => {
				const priority = TODO_PRIORITIES.find(priority => String(priority) === value);
				if (priority !== undefined && priority !== todo.priority) onChange({ op: "set-priority", id: todo.id, priority });
			}}
		/>
	);
}

export function TodoAssigneePicker({ todo, look, onChange, ...props }: TodoFieldProps) {
	const { label } = ASSIGNEE[todo.assignee ?? "none"];
	return (
		<FieldPicker
			{...props}
			field="Assignee"
			current={label}
			trigger={
				<>
					<AssigneeIcon assignee={todo.assignee} />
					{look === "property" && <span className={cn("truncate", todo.assignee === null && "text-muted-foreground")}>{todo.assignee === null ? "Assignee" : label}</span>}
				</>
			}
			className={BUTTON[look]}
			choices={ASSIGNEE_CHOICES}
			selected={[todo.assignee ?? ""]}
			firstKey={0}
			onPick={value => {
				const assignee = value === "" ? null : TODO_ASSIGNEES.find(assignee => assignee === value);
				if (assignee !== undefined && assignee !== todo.assignee) onChange({ op: "set-assignee", id: todo.id, assignee });
			}}
		/>
	);
}

/** The due day as the lists read it, `Today` or `Overdue · Oct 3`, red once it has passed; `day` is today. */
export function DueText({ due, day }: { due: string; day: string }) {
	const { text, overdue } = dueLabel(due, day);
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1 [&>svg]:shrink-0", overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
			<CalendarClock aria-hidden />
			<span className="truncate">{text}</span>
		</span>
	);
}

export function TodoDuePicker({ todo, look, day, onChange, ...props }: TodoFieldProps & { day: string }) {
	return (
		<DuePicker
			{...props}
			dueDate={todo.due}
			trigger={
				todo.due ? (
					<DueText due={todo.due} day={day} />
				) : (
					<span className="inline-flex items-center gap-1 text-muted-foreground">
						<CalendarClock aria-hidden />
						{look === "property" && "Due date"}
					</span>
				)
			}
			className={cn(BUTTON[look], look === "icon" ? "w-auto px-1 text-xs [&_svg]:size-3" : "[&_svg]:size-4")}
			onChange={due => onChange({ op: "set-due", id: todo.id, due })}
		/>
	);
}
