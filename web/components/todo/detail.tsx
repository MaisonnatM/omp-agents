import { ChevronDown, ChevronRight, ChevronUp, Play, Plus, Ticket, X } from "lucide-react";
import { useState } from "react";
import { errorText } from "../../../src/json";
import { hashForSession } from "../../../src/shared/sessions";
import type { TicketChoice, TicketDraft } from "../../../src/shared/tickets";
import { addTodo } from "../../../src/user-todos";
import type { UserTodo, UserTodoChange, UserTodoList } from "../../../src/user-todos-shared";
import { badgeColors } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson, putJson } from "../../api";
import { dayLabel } from "../../labels";
import { hashForNewSession } from "../../routing";
import { shortcutLabels } from "../../shortcuts";
import { categoryColor, TODO_STATUS, type TodoEntry } from "../../todo-views";
import { workStateOf } from "../../todo-work-state";
import type { TodoField } from "../../use-todo-keys";
import { type Choice, FieldPicker } from "../field-picker";
import { NotesEditor } from "../notes-editor";
import { preferredTeam, rememberTeam, TeamSelect } from "../tickets/team-select";
import { StatusIcon, TodoDuePicker, TodoPriorityPicker, TodoStatusPicker } from "./fields";
import { TodoInput } from "./input";
import { AddedByChip, type KnownSessions, TodoLinkChip, TodoWorkPill } from "./links";

/** Opening a Linear issue from a todo: pick its team, then create it, which links it to the todo. */
type TicketStep =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "picking"; teams: TicketChoice[]; team: string }
	| { kind: "creating"; teams: TicketChoice[]; team: string }
	| { kind: "failed"; error: string };

function CreateTicket({ todo, onChange }: { todo: UserTodo; onChange: (change: UserTodoChange) => void }) {
	const [step, setStep] = useState<TicketStep>({ kind: "idle" });
	const start = async (): Promise<void> => {
		setStep({ kind: "loading" });
		try {
			const teams = await getJson<TicketChoice[]>("/api/linear/teams");
			if (teams.length === 0) return setStep({ kind: "failed", error: "Linear lists no team to open the issue in." });
			setStep({ kind: "picking", teams, team: preferredTeam(teams) });
		} catch (err) {
			setStep({ kind: "failed", error: errorText(err) });
		}
	};
	const create = async (teams: TicketChoice[], team: string): Promise<void> => {
		setStep({ kind: "creating", teams, team });
		try {
			const { identifier } = await putJson<{ identifier: string }>("/api/ticket/new", { title: todo.text, description: todo.body, team } satisfies TicketDraft);
			rememberTeam(team);
			onChange({ op: "link", id: todo.id, link: { kind: "ticket", identifier } });
			setStep({ kind: "idle" });
		} catch (err) {
			setStep({ kind: "failed", error: errorText(err) });
		}
	};
	if (step.kind === "idle" || step.kind === "loading" || step.kind === "failed") {
		const loading = step.kind === "loading";
		const createButton = (
			<Button variant="tertiary" size="compact" leadingIcon={Ticket} disabled={loading} onClick={() => void start()}>
				{loading ? "Reading teams…" : "Create Linear ticket"}
			</Button>
		);
		return (
			<div className="flex flex-wrap items-center gap-2">
				<Tooltip content="Create a Linear issue from this todo" disabled={loading}>
					{createButton}
				</Tooltip>
				{step.kind === "failed" && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{step.error}
					</p>
				)}
			</div>
		);
	}
	const { teams, team } = step;
	const creating = step.kind === "creating";
	const createButton = (
		<Button size="compact" disabled={creating} onClick={() => void create(teams, team)}>
			{creating ? "Creating…" : "Create, assigned to you"}
		</Button>
	);
	const cancelButton = (
		<Button variant="ghost" size="compact" disabled={creating} onClick={() => setStep({ kind: "idle" })}>
			Cancel
		</Button>
	);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<TeamSelect teams={teams} value={team} disabled={creating} onChange={next => setStep({ kind: "picking", teams, team: next })} />
			<Tooltip content="Create the issue in this team, assigned to you" disabled={creating}>
				{createButton}
			</Tooltip>
			<Tooltip content="Don't create the issue" disabled={creating}>
				{cancelButton}
			</Tooltip>
		</div>
	);
}

interface TodoDetailProps {
	list: UserTodoList;
	open: TodoEntry;
	/** Changes would not reach the server, or the todo is archived. */
	readOnly: boolean;
	/** Today, `YYYY-MM-DD`. */
	day: string;
	/** The picker of the open todo a key opened, `null` for none. */
	picker: TodoField | null;
	onPicker: (field: TodoField | null) => void;
	onChange: (change: UserTodoChange) => void;
	/** Opens another todo: a sub-todo from its row. */
	onOpen: (id: string) => void;
	onClose: () => void;
	/** Opens the todo above or below in the list; absent at either end. */
	onPrevious?: () => void;
	onNext?: () => void;
	sessions: KnownSessions;
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
	linearConnected: boolean;
}

function CategoryDot({ categoryId }: { categoryId: string | null }) {
	return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryId === null ? "var(--muted-foreground)" : badgeColors[categoryColor(categoryId)] }} />;
}

/** A top-level todo's sub-todos: how many are done, a row per sub-todo with its own status and priority, and a way to add one. */
function SubTodos({ todo, readOnly, onChange, onOpen }: { todo: UserTodo; readOnly: boolean; onChange: (change: UserTodoChange) => void; onOpen: (id: string) => void }) {
	// A fresh input after each added sub-todo, so it starts empty; `null` while none is being typed.
	const [adding, setAdding] = useState<number | null>(null);
	const { children } = todo;
	const done = children.filter(child => child.doneAt !== null).length;
	const add = (text: string): boolean => {
		const trimmed = text.replace(/\s+/g, " ").trim();
		if (trimmed) onChange(addTodo({ parentId: todo.id, afterId: children.findLast(child => child.doneAt === null)?.id ?? null, text: trimmed }));
		return trimmed !== "";
	};
	if (children.length === 0 && (readOnly || adding === null)) {
		return readOnly ? null : (
			<Button variant="ghost" size="compact" leadingIcon={Plus} className="self-start text-muted-foreground" onClick={() => setAdding(0)}>
				Add sub-todos
			</Button>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
				<h3>Sub-todos</h3>
				<span className="tabular-nums" aria-label={`${done} of ${children.length} done`}>
					{done}/{children.length}
				</span>
				<div aria-hidden className="ml-1 h-1 w-24 overflow-hidden rounded-full bg-muted">
					<div className="h-full bg-primary" style={{ width: `${children.length === 0 ? 0 : (done / children.length) * 100}%` }} />
				</div>
				{!readOnly && (
					<Tooltip content="Add a sub-todo">
						<Button variant="ghost" size="icon-compact" aria-label="Add a sub-todo" className="ml-auto" onClick={() => setAdding(adding ?? 0)}>
							<Plus />
						</Button>
					</Tooltip>
				)}
			</div>
			<ul aria-label={`Sub-todos of ${todo.text}`} className="divide-y divide-border rounded-md border border-border">
				{children.map(child => (
					<li key={child.id} className="flex h-9 items-center gap-1.5 px-2 text-sm">
						<TodoPriorityPicker todo={child} look="icon" disabled={readOnly} onChange={onChange} />
						<TodoStatusPicker todo={child} look="icon" disabled={readOnly} onChange={onChange} />
						<button
							type="button"
							onClick={() => onOpen(child.id)}
							className={cn("min-w-0 flex-1 truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", child.doneAt !== null && "text-muted-foreground line-through")}
						>
							{child.text}
						</button>
					</li>
				))}
				{adding !== null && (
					<li className="flex h-9 items-center gap-1.5 px-2 text-sm">
						<span className="flex w-[54px] shrink-0 justify-end pr-1">
							<StatusIcon status="todo" className="opacity-60" />
						</span>
						<TodoInput
							key={adding}
							initial=""
							label="New sub-todo"
							onKey={(key, text) => {
								if (key === "enter" && add(text)) setAdding(adding + 1);
								else if (key === "enter" || key === "escape") setAdding(null);
								else return false;
								return true;
							}}
							onLeave={text => {
								add(text);
								setAdding(null);
							}}
						/>
					</li>
				)}
			</ul>
		</div>
	);
}

/**
 * What an agent does with a top-level todo: the linked session's state and its open question, with the way to reply,
 * and **Start session**. Without a linked session, just **Start session**.
 */
function AgentCard({ todo, readOnly, sessions, newSessionCwd }: { todo: UserTodo; readOnly: boolean; sessions: KnownSessions; newSessionCwd: string }) {
	const linked = todo.links.findLast(link => link.kind === "session");
	const sessionId = linked?.kind === "session" ? linked.sessionId : null;
	const question = sessionId === null ? undefined : sessions.hosts.find(host => host.sessionId === sessionId)?.requests[0];
	const start = (
		<Tooltip content="Start a session from this todo">
			<Button variant={question ? "secondary" : "primary"} size="compact" leadingIcon={Play} asChild>
				<a href={hashForNewSession(newSessionCwd, todo.id)}>{sessionId === null ? "Start session" : "Start another session"}</a>
			</Button>
		</Tooltip>
	);
	if (sessionId === null) return readOnly ? null : <div>{start}</div>;
	return (
		<div className="rounded-lg border border-border text-sm">
			<div className="flex items-center gap-2 px-3 py-2">
				<TodoWorkPill state={workStateOf(todo, sessions)} />
			</div>
			{question && (
				<div className="border-t border-border bg-amber-500/10 px-3 py-2">
					<p className="text-xs font-medium text-amber-900 dark:text-amber-200">Agent asks</p>
					<p className="mt-0.5 whitespace-pre-wrap">{question.title}</p>
				</div>
			)}
			{!readOnly && (
				<div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
					{question && (
						<Button variant="primary" size="compact" asChild>
							<a href={hashForSession(sessionId)}>Reply in session</a>
						</Button>
					)}
					{start}
				</div>
			)}
		</div>
	);
}

/**
 * The open todo: a bar with where it sits and the way to its neighbours, then its title, its properties as pickers, its
 * notes, and for a top-level todo its sub-todos, agent, links, and when it was added.
 */
export function TodoDetail({ list, open, readOnly, day, picker, onPicker, onChange, onOpen, onClose, onPrevious, onNext, sessions, newSessionCwd, linearConnected }: TodoDetailProps) {
	const { todo } = open;
	const top = open.parent === null ? open.todo : null;
	const categoryId = (open.parent ?? open.todo).categoryId;
	const category = list.categories.find(({ id }) => id === categoryId)?.name ?? "No category";
	const pickerOf = (field: TodoField) => ({ open: picker === field, onOpenChange: (next: boolean) => onPicker(next ? field : null) });
	const categoryChoices: Choice[] = [{ id: null, name: "No category" }, ...list.categories].map(({ id, name }) => ({ value: id ?? "", label: name, icon: <CategoryDot categoryId={id} /> }));
	const links = top?.links ?? [];
	return (
		<section aria-label={todo.text} className="flex min-w-0 flex-col">
			<div className="sticky top-0 z-10 flex h-11 items-center gap-1 border-b border-border bg-background/95 px-4 backdrop-blur">
				<p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
					<CategoryDot categoryId={categoryId} />
					<span className="shrink-0">{category}</span>
					{open.parent && (
						<>
							<ChevronRight aria-hidden className="size-3 shrink-0" />
							<span className="truncate">{open.parent.text}</span>
						</>
					)}
					<ChevronRight aria-hidden className="size-3 shrink-0" />
					<StatusIcon status={todo.status} className="size-3.5" />
					<span className="shrink-0">{TODO_STATUS[todo.status].label}</span>
				</p>
				<Tooltip content="Previous todo" shortcut={shortcutLabels("todoPrevious")}>
					<Button variant="ghost" size="icon-compact" aria-label="Previous todo" disabled={!onPrevious} onClick={onPrevious}>
						<ChevronUp />
					</Button>
				</Tooltip>
				<Tooltip content="Next todo" shortcut={shortcutLabels("todoNext")}>
					<Button variant="ghost" size="icon-compact" aria-label="Next todo" disabled={!onNext} onClick={onNext}>
						<ChevronDown />
					</Button>
				</Tooltip>
				<Tooltip content="Close" shortcut={shortcutLabels("todoClose")}>
					<Button variant="ghost" size="icon-compact" aria-label="Close the todo" onClick={onClose}>
						<X />
					</Button>
				</Tooltip>
			</div>
			<div className="flex flex-col gap-5 px-6 py-5">
				{readOnly ? (
					<h2 className="break-words text-xl font-semibold leading-snug text-muted-foreground">{todo.text}</h2>
				) : (
					<textarea
						key={todo.text}
						aria-label="Title"
						rows={1}
						defaultValue={todo.text}
						onKeyDown={event => {
							if (event.key === "Escape") event.currentTarget.value = todo.text;
							if (event.key === "Enter" || event.key === "Escape") {
								event.preventDefault();
								event.currentTarget.blur();
							}
						}}
						onBlur={event => {
							const text = event.currentTarget.value.replace(/\s+/g, " ").trim();
							if (text && text !== todo.text) onChange({ op: "edit", id: todo.id, text });
							else event.currentTarget.value = todo.text;
						}}
						className="field-sizing-content -mx-1 -mb-3 resize-none rounded-md bg-transparent px-1 text-xl font-semibold leading-snug outline-none hover:bg-accent/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring"
					/>
				)}
				<div className="flex flex-wrap items-center gap-1.5" aria-label="Properties">
					<TodoStatusPicker todo={todo} look="property" disabled={readOnly} {...pickerOf("status")} onChange={onChange} />
					<TodoPriorityPicker todo={todo} look="property" disabled={readOnly} {...pickerOf("priority")} onChange={onChange} />
					{top && (
						<FieldPicker
							field="Category"
							current={category}
							trigger={
								<>
									<CategoryDot categoryId={top.categoryId} />
									<span className="truncate">{category}</span>
								</>
							}
							className="h-7 shrink-0 justify-start border border-border px-2 text-[13px] font-normal text-foreground"
							choices={categoryChoices}
							selected={[top.categoryId ?? ""]}
							disabled={readOnly}
							onPick={value => {
								const next = value || null;
								if (next !== top.categoryId) onChange({ op: "categorize", id: top.id, categoryId: next });
							}}
						/>
					)}
					<TodoDuePicker todo={todo} look="property" day={day} disabled={readOnly} {...pickerOf("due")} onChange={onChange} />
				</div>
				<NotesEditor key={todo.id} value={todo.body} label={`Notes of ${todo.text}`} readOnly={readOnly} onSave={body => onChange({ op: "edit-body", id: todo.id, body })} />
				{top && <SubTodos todo={top} readOnly={readOnly} onChange={onChange} onOpen={onOpen} />}
				{top && <AgentCard todo={top} readOnly={readOnly} sessions={sessions} newSessionCwd={newSessionCwd} />}
				{top && (links.length > 0 || (!readOnly && linearConnected && !links.some(link => link.kind === "ticket"))) && (
					<div className="flex flex-col gap-1.5">
						<h3 className="text-xs font-medium text-muted-foreground">Links</h3>
						<div className="flex flex-wrap items-center gap-1.5" aria-label="Links">
							{links.map(link => (
								<TodoLinkChip key={JSON.stringify(link)} link={link} sessions={sessions} onRemove={readOnly ? undefined : () => onChange({ op: "unlink", id: top.id, link })} />
							))}
						</div>
						{!readOnly && linearConnected && !links.some(link => link.kind === "ticket") && <CreateTicket todo={top} onChange={onChange} />}
					</div>
				)}
				{(todo.createdAt || top?.addedBy) && (
					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
						{todo.createdAt && <span>Created {dayLabel(todo.createdAt)}</span>}
						{top?.addedBy && <AddedByChip sessionId={top.addedBy} sessions={sessions} />}
					</div>
				)}
			</div>
		</section>
	);
}
