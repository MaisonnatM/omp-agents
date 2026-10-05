import { Circle, CircleCheck, Play, Ticket, X } from "lucide-react";
import { useState } from "react";
import type { TicketChoice, TicketDraft, UserTodo, UserTodoChange, UserTodoList } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson, putJson } from "../api";
import { errorText } from "../../src/json";
import { hashForNewSession } from "../routing";
import type { TodoEntry } from "../todo-views";
import { MarkdownEditor } from "./markdown-editor";
import { AddedByChip, type KnownSessions, TodoLinkChip } from "./todo-links";

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
				<Tooltip content="Create a Linear issue from this todo">
					{loading ? <span className="inline-flex">{createButton}</span> : createButton}
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
			<Tooltip content="Create the issue in this team, assigned to you">
				{creating ? <span className="inline-flex">{createButton}</span> : createButton}
			</Tooltip>
			<Tooltip content="Don't create the issue">
				{creating ? <span className="inline-flex">{cancelButton}</span> : cancelButton}
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
	sessions: KnownSessions;
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
	linearConnected: boolean;
}

/** The open todo: its title, category, due day, links, actions, and markdown notes. */
export function TodoDetail({ list, open, readOnly, onChange, onClose, sessions, newSessionCwd, linearConnected }: TodoDetailProps) {
	const { todo } = open;
	const done = todo.doneAt !== null;
	const top = open.parent === null ? open.todo : null;
	return (
		<section aria-label={todo.text} className="flex min-w-0 flex-col gap-3 self-start md:sticky md:top-6">
			<div className="flex items-start gap-2">
				<Tooltip content={done ? "Mark not done" : "Mark done"}>
					{readOnly ? (
						<span className="inline-flex">
							<button type="button" role="checkbox" aria-checked={done} aria-label={todo.text} disabled className="mt-0.5 shrink-0 text-muted-foreground disabled:pointer-events-none [&>svg]:size-4">
								{done ? <CircleCheck /> : <Circle />}
							</button>
						</span>
					) : (
						<button
							type="button"
							role="checkbox"
							aria-checked={done}
							aria-label={todo.text}
							onClick={() => onChange({ op: "toggle", id: todo.id, doneAt: done ? null : new Date().toISOString() })}
							className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground [&>svg]:size-4"
						>
							{done ? <CircleCheck /> : <Circle />}
						</button>
					)}
				</Tooltip>
				<h3 className={cn("min-w-0 flex-1 break-words text-base font-semibold leading-snug", done && "text-muted-foreground line-through")}>{todo.text}</h3>
				<Tooltip content="Close">
					<Button variant="ghost" size="icon-compact" aria-label="Close the todo" onClick={onClose}>
						<X />
					</Button>
				</Tooltip>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
				{open.parent ? (
					<p>Under {open.parent.text}</p>
				) : (
					<label className="flex items-center gap-2">
						Category
						<select
							value={open.todo.categoryId ?? ""}
							disabled={readOnly}
							onChange={event => onChange({ op: "categorize", id: todo.id, categoryId: event.target.value || null })}
							className={FIELD}
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
				<label className="flex items-center gap-2">
					Due
					<input
						type="date"
						value={todo.due ?? ""}
						disabled={readOnly}
						onChange={event => onChange({ op: "set-due", id: todo.id, due: event.target.value || null })}
						className={FIELD}
					/>
				</label>
				{todo.due && !readOnly && (
					<Tooltip content="Clear the due day">
						<button type="button" onClick={() => onChange({ op: "set-due", id: todo.id, due: null })} className="hover:text-foreground">
							No due day
						</button>
					</Tooltip>
				)}
			</div>
			{top && (top.links.length > 0 || top.addedBy) && (
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
			)}
			{top && !readOnly && (
				<div className="flex flex-wrap items-center gap-2">
					<Tooltip content="Start a session from this todo">
						<Button variant="tertiary" size="compact" leadingIcon={Play} asChild>
							<a href={hashForNewSession(newSessionCwd, top.id)}>Start session</a>
						</Button>
					</Tooltip>
					{linearConnected && !top.links.some(link => link.kind === "ticket") && <CreateTicket todo={top} onChange={onChange} />}
				</div>
			)}
			<MarkdownEditor
				key={todo.id}
				value={todo.body}
				label={`Notes of ${todo.text}`}
				readOnly={readOnly}
				onSave={body => onChange({ op: "edit-body", id: todo.id, body })}
			/>
		</section>
	);
}
