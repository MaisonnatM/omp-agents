import { CalendarClock, ChevronDown, ChevronRight, ChevronUp, Circle, CircleCheck, Play, Ticket, X } from "lucide-react";
import { useState } from "react";
import { errorText } from "../../../src/json";
import { hashForSession } from "../../../src/shared/sessions";
import type { TicketChoice, TicketDraft } from "../../../src/shared/tickets";
import type { UserTodo, UserTodoChange, UserTodoList } from "../../../src/user-todos-shared";
import { badgeColors } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson, putJson } from "../../api";
import { hashForNewSession } from "../../routing";
import { shortcutLabels } from "../../shortcuts";
import { categoryColor, type TodoEntry } from "../../todo-views";
import { workStateOf } from "../../todo-work-state";
import { MarkdownEditor } from "../markdown-editor";
import { AddedByChip, type KnownSessions, TodoLinkChip, TodoWorkPill } from "./links";

const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

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
			setStep({ kind: "picking", teams, team: teams[0]!.id });
		} catch (err) {
			setStep({ kind: "failed", error: errorText(err) });
		}
	};
	const create = async (teams: TicketChoice[], team: string): Promise<void> => {
		setStep({ kind: "creating", teams, team });
		try {
			const { identifier } = await putJson<{ identifier: string }>("/api/ticket/new", { title: todo.text, description: todo.body, team } satisfies TicketDraft);
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
			<label className="flex items-center gap-2 text-xs text-muted-foreground">
				Team
				<select value={team} disabled={creating} onChange={event => setStep({ kind: "picking", teams, team: event.target.value })} className={FIELD}>
					{teams.map(({ id, name }) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</select>
			</label>
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
	onChange: (change: UserTodoChange) => void;
	onClose: () => void;
	/** Opens the todo above or below in the list; absent at either end. */
	onPrevious?: () => void;
	onNext?: () => void;
	sessions: KnownSessions;
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
	linearConnected: boolean;
}

const CHIP = "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0";

/** The open todo: a bar with where it sits and the way to its neighbours, then its title, properties, actions, and markdown notes. */
export function TodoDetail({ list, open, readOnly, onChange, onClose, onPrevious, onNext, sessions, newSessionCwd, linearConnected }: TodoDetailProps) {
	const { todo } = open;
	const top = open.parent === null ? open.todo : null;
	const categoryId = (open.parent ?? open.todo).categoryId;
	const category = list.categories.find(({ id }) => id === categoryId)?.name ?? "No category";
	const done = todo.doneAt !== null;
	const linkedSession = top?.links.findLast(link => link.kind === "session");
	const host = linkedSession?.kind === "session" ? sessions.hosts.find(host => host.sessionId === linkedSession.sessionId) : undefined;
	const question = host?.requests[0];
	return (
		<section aria-label={todo.text} className="flex min-w-0 flex-col">
			<div className="sticky top-0 z-10 flex h-11 items-center gap-1 border-b border-border bg-background/95 px-4 backdrop-blur">
				<p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
					<span className="shrink-0">{category}</span>
					{open.parent && (
						<>
							<ChevronRight aria-hidden className="size-3 shrink-0" />
							<span className="truncate">{open.parent.text}</span>
						</>
					)}
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
			<div className="flex flex-col gap-4 px-6 py-5">
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
						className="field-sizing-content -mx-1 resize-none rounded-md bg-transparent px-1 text-xl font-semibold leading-snug outline-none hover:bg-accent/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring"
					/>
				)}
				<div className="flex flex-wrap items-center gap-1.5" aria-label="Properties">
					<button
						type="button"
						role="checkbox"
						aria-checked={done}
						disabled={readOnly}
						onClick={() => onChange({ op: "toggle", id: todo.id, doneAt: done ? null : new Date().toISOString() })}
						className={cn(CHIP, !readOnly && "hover:text-foreground", done && "text-emerald-700 dark:text-emerald-400")}
					>
						{done ? <CircleCheck /> : <Circle />}
						{done ? "Done" : "To do"}
					</button>
					{top && (
						<label className={cn(CHIP, "pr-1")}>
							<span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: top.categoryId === null ? "var(--muted-foreground)" : badgeColors[categoryColor(top.categoryId)] }} />
							<select
								aria-label="Category"
								value={top.categoryId ?? ""}
								disabled={readOnly}
								onChange={event => onChange({ op: "categorize", id: todo.id, categoryId: event.target.value || null })}
								className="appearance-none bg-transparent pr-1 text-foreground outline-none"
							>
								<option value="">No category</option>
								{list.categories.map(category => (
									<option key={category.id} value={category.id}>
										{category.name}
									</option>
								))}
							</select>
						</label>
					)}
					<label className={CHIP}>
						<CalendarClock aria-hidden />
						<input
							type="date"
							aria-label="Due day"
							value={todo.due ?? ""}
							disabled={readOnly}
							onChange={event => onChange({ op: "set-due", id: todo.id, due: event.target.value || null })}
							className="bg-transparent text-foreground outline-none"
						/>
						{todo.due && !readOnly && (
							<Tooltip content="Clear the due day">
								<button type="button" aria-label="No due day" onClick={() => onChange({ op: "set-due", id: todo.id, due: null })} className="hover:text-foreground [&>svg]:size-3">
									<X />
								</button>
							</Tooltip>
						)}
					</label>
					{top && !done && <TodoWorkPill state={workStateOf(top, sessions)} />}
				</div>
				{question && linkedSession?.kind === "session" && (
					<div className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
						<p className="font-medium text-amber-900 dark:text-amber-200">Agent asks</p>
						<p className="mt-1 whitespace-pre-wrap">{question.title}</p>
						<a href={hashForSession(linkedSession.sessionId)} className="mt-2 inline-block text-xs font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200">Reply in session</a>
					</div>
				)}
				{top && (top.links.length > 0 || top.addedBy) && (
					<div className="flex flex-col gap-1.5">
						<h3 className="text-xs font-medium text-muted-foreground">Links</h3>
						<div className="flex flex-wrap items-center gap-1.5" aria-label="Links">
							{top.addedBy && <AddedByChip sessionId={top.addedBy} sessions={sessions} />}
							{top.links.map(link => (
								<TodoLinkChip
									key={JSON.stringify(link)}
									link={link}
									sessions={sessions}
									onRemove={readOnly ? undefined : () => onChange({ op: "unlink", id: top.id, link })}
								/>
							))}
						</div>
					</div>
				)}
				{top && !readOnly && (
					<div className="flex flex-wrap items-center gap-2">
						<Tooltip content="Start a session from this todo">
							<Button variant="primary" size="compact" leadingIcon={Play} asChild>
								<a href={hashForNewSession(newSessionCwd, top.id)}>Start session</a>
							</Button>
						</Tooltip>
						{linearConnected && !top.links.some(link => link.kind === "ticket") && <CreateTicket todo={top} onChange={onChange} />}
					</div>
				)}
				<div className="flex flex-col gap-1.5 border-t border-border pt-4">
					<h3 className="text-xs font-medium text-muted-foreground">Notes</h3>
					<MarkdownEditor
						key={todo.id}
						value={todo.body}
						label={`Notes of ${todo.text}`}
						readOnly={readOnly}
						onSave={body => onChange({ op: "edit-body", id: todo.id, body })}
					/>
				</div>
			</div>
		</section>
	);
}
