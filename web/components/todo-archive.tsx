import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { UserTodoChange, UserTodoList } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DAY_FORMAT, LIST_KINDS, matches, placeIn } from "../todo-views";
import { PageFrame } from "./list-sheet-page";
import { TodoDetail } from "./todo-detail";
import type { KnownSessions } from "./todo-links";
import { TodoSearch } from "./todo-search";

interface ArchivePageProps {
	list: UserTodoList;
	/** Changes would not reach the server. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	sessions: KnownSessions;
	newSessionCwd: string;
	linearConnected: boolean;
}

/** The todos **Clear done** put away, latest first: each can go back in the list or be deleted for good. */
export function ArchivePage({ list, disabled, onChange, sessions, newSessionCwd, linearConnected }: ArchivePageProps) {
	const [query, setQuery] = useState("");
	const [openId, setOpenId] = useState<string | null>(null);
	const shown = list.archive.filter(todo => matches(todo, query));
	const open = openId === null ? null : placeIn([list.archive], openId)?.entry;
	return (
		<PageFrame
			title={LIST_KINDS.done.title}
			meta={`${list.archive.length} done`}
			actions={
				<>
					<TodoSearch query={query} onQuery={setQuery} />
					{list.archive.length > 0 && !disabled && (
						<Button
							variant="ghost"
							size="compact"
							leadingIcon={Trash2}
							onClick={() => {
								if (window.confirm(`Delete the ${list.archive.length} archived todos for good?`)) onChange({ op: "empty-archive" });
							}}
						>
							Empty
						</Button>
					)}
				</>
			}
		>
			<div className={cn("mx-auto grid w-full gap-8 px-6 py-6", open ? "max-w-6xl md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : "max-w-3xl")}>
				<section aria-label="Done" className="space-y-1">
					<ul aria-label="Archived todos" className="flex flex-col gap-0.5">
						{shown.map(todo => (
							<li key={todo.id} className={cn("group/todo flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug hover:bg-accent/50", todo.id === openId && "bg-accent")}>
								<Archive aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<button type="button" onClick={() => setOpenId(todo.id)} className="min-w-0 flex-1 break-words text-left text-muted-foreground">
									{todo.text}
									{todo.children.length > 0 && <span className="ml-2 text-xs tabular-nums">{todo.children.length} under it</span>}
								</button>
								{todo.doneAt && <span className="shrink-0 text-xs text-muted-foreground">{DAY_FORMAT.format(new Date(todo.doneAt))}</span>}
								{!disabled && (
									<span className="flex shrink-0 gap-1 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100 [&_svg]:size-3.5">
										<Tooltip content="Put back in the list">
											<button
												type="button"
												aria-label={`Put ${todo.text} back`}
												onClick={() => onChange({ op: "unarchive", id: todo.id })}
												className="text-muted-foreground hover:text-foreground"
											>
												<RotateCcw />
											</button>
										</Tooltip>
										<Tooltip content="Delete for good">
											<button
												type="button"
												aria-label={`Delete ${todo.text} for good`}
												onClick={() => onChange({ op: "remove", id: todo.id })}
												className="text-muted-foreground hover:text-foreground"
											>
												<Trash2 />
											</button>
										</Tooltip>
									</span>
								)}
							</li>
						))}
					</ul>
					{shown.length === 0 && <p className="px-2 text-sm text-muted-foreground">{query ? `No todo matches “${query}”.` : LIST_KINDS.done.empty}</p>}
				</section>
				{open && (
					<TodoDetail
						key={open.todo.id}
						list={list}
						open={open}
						readOnly
						onChange={onChange}
						onClose={() => setOpenId(null)}
						sessions={sessions}
						newSessionCwd={newSessionCwd}
						linearConnected={linearConnected}
					/>
				)}
			</div>
		</PageFrame>
	);
}
