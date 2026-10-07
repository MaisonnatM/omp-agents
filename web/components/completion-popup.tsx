import { ChevronRight } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type TextareaHTMLAttributes, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangedFile } from "../../src/shared/transcript";
import { cn } from "@/lib/utils";
import { completionTrigger } from "../completion-trigger";
import { completionOption, fileSearch, mentionMenu, mentionQuery, type MenuOption, type MenuSection } from "../mentions";
import type { Completions } from "../pane-store";
import { inboxStore, ticketsStore } from "../reads";
import { MentionListsContext } from "./dashboard-context";

export function CompletionPopup({ id, sections, active, onPick, error }: {
	id: string;
	sections: MenuSection[];
	/** Among the options of every section, in order. */
	active: number;
	onPick: (option: MenuOption) => void;
	error: string | null;
}) {
	let index = 0;
	return (
		<div className="absolute inset-x-6 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" aria-label="Completions">
		<div id={id} role="listbox" aria-label="Suggestions" className="max-h-64 overflow-y-auto p-1">
			{sections.map((section, at) => (
				<div
					key={at}
					role="group"
					aria-labelledby={section.title === null ? undefined : `${id}-section-${at}`}
					className={cn(at > 0 && section.title === null && "mt-1 border-t border-border pt-1")}
				>
					{section.title !== null && (
						<p id={`${id}-section-${at}`} className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
							{section.title}
						</p>
					)}
					{section.options.map(option => {
						const optionIndex = index++;
						const Icon = option.icon;
						return (
							<div
								key={`${optionIndex}:${option.key}`}
								id={`${id}-${optionIndex}`}
								role="option"
								aria-selected={optionIndex === active}
								className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
								onMouseDown={event => event.preventDefault()}
								onClick={() => onPick(option)}
							>
								<Icon size={16} aria-hidden="true" />
								<span className="min-w-0 flex-1 truncate">{option.label}</span>
								{option.detail && <span className="max-w-[45%] truncate text-xs opacity-70">{option.detail}</span>}
								{option.opens && <ChevronRight size={14} aria-hidden="true" className="opacity-70" />}
							</div>
						);
					})}
				</div>
			))}
			{!sections.length && <p className="px-3 py-2 text-xs text-muted-foreground">{error ?? "No matches"}</p>}
		</div>
		<p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">↑ ↓ navigate · Tab or Enter insert · Esc close</p>
		</div>
	);
}

interface CompletionOptions {
	draft: string;
	setDraft: (text: string) => void;
	/** The server's last answer to this composer's `complete`. */
	completions: Completions | null;
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** The composer's own keys, which run while no list is open. */
	onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
	/** The composer's session, which `@` does not offer; `null` for the new-session draft. */
	sessionId: string | null;
	/** The files the view's agent changed, which `@` offers first. */
	changed: ChangedFile[];
}

interface Completion {
	/** For the composer's `InputMessage`, whose textarea the caret is read from. */
	composerRef: RefObject<HTMLDivElement | null>;
	/** The open list, placed just before the composer. */
	popup: ReactNode;
	onValueChange: (text: string) => void;
	textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement>;
	close: () => void;
}

/**
 * omp's `/` completion and the `@` menu for a composer: suggestions follow the caret, and the open list owns Esc, the
 * arrows, Tab, and Enter. Live sessions and the new-session draft share it, so both offer the same commands and skills.
 * The `@` menu adds todos, tickets, pull requests, and sessions to omp's files; it asks the server only for files.
 */
export function useCompletion({ draft, setDraft, completions, onComplete, onKeyDown, sessionId, changed }: CompletionOptions): Completion {
	/** The draft and caret the open list answers, and the `complete` request whose answer it shows, if it sent one. */
	const [menu, setMenu] = useState<OpenMenu | null>(null);
	const [active, setActive] = useState(0);
	/** The open list's options, which {@link MenuList} reports after each render, for the keys. */
	const options = useRef<MenuOption[]>([]);
	const [count, setCount] = useState(0);
	const nextId = useRef(0);
	const composerRef = useRef<HTMLDivElement>(null);
	const popupId = useId();
	const answer = completions && completions.reqId === menu?.reqId ? completions : null;
	const shown = Math.min(active, count - 1);

	const suggest = (text: string, cursor: number): void => {
		const trigger = completionTrigger(text, cursor);
		if (!trigger) {
			setMenu(null);
			return;
		}
		const request = trigger === "slash" ? { text, cursor } : fileSearch(text, cursor);
		const reqId = request ? ++nextId.current : null;
		setMenu({ text, cursor, reqId });
		setActive(0);
		if (request && reqId !== null) onComplete(reqId, request.text, request.cursor);
	};
	const pick = ({ edit, opens }: MenuOption): void => {
		setDraft(edit.text);
		if (opens) suggest(edit.text, edit.cursor);
		else setMenu(null);
		requestAnimationFrame(() => {
			const el = composerRef.current?.querySelector("textarea");
			el?.focus();
			el?.setSelectionRange(edit.cursor, edit.cursor);
		});
	};
	const report = (next: MenuOption[]): void => {
		options.current = next;
		setCount(next.length);
	};

	return {
		composerRef,
		popup: menu !== null && <MenuList id={popupId} menu={menu} answer={answer} sessionId={sessionId} changed={changed} active={shown} onPick={pick} onOptions={report} />,
		onValueChange: text => {
			setDraft(text);
			suggest(text, composerRef.current?.querySelector("textarea")?.selectionStart ?? text.length);
		},
		textareaProps: {
			"aria-controls": menu !== null ? popupId : undefined,
			"aria-expanded": menu !== null,
			"aria-autocomplete": "list",
			"aria-activedescendant": menu !== null && count ? `${popupId}-${shown}` : undefined,
			onClick: event => suggest(draft, event.currentTarget.selectionStart),
			onKeyUp: event => {
				if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) suggest(draft, event.currentTarget.selectionStart);
			},
			onKeyDown: event => {
				if (menu === null || event.nativeEvent.isComposing || (event.key === "Tab" && event.shiftKey)) return onKeyDown?.(event);
				if (event.key === "Escape") {
					event.preventDefault();
					setMenu(null);
				} else if (count && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
					event.preventDefault();
					setActive(index => (Math.min(index, count - 1) + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
				} else if (count && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
					event.preventDefault();
					pick(options.current[shown]);
				}
			},
		},
		close: () => setMenu(null),
	};
}

interface OpenMenu {
	text: string;
	cursor: number;
	reqId: number | null;
}

/**
 * The open list, apart from {@link useCompletion} so that only it reads the page's lists and polls tickets and the
 * inbox: a roster or inbox change then renders the list again, not the conversation that holds the composer.
 */
function MenuList({ id, menu, answer, sessionId, changed, active, onPick, onOptions }: {
	id: string;
	menu: OpenMenu;
	answer: Completions | null;
	sessionId: string | null;
	changed: ChangedFile[];
	active: number;
	onPick: (option: MenuOption) => void;
	onOptions: (options: MenuOption[]) => void;
}) {
	const lists = useContext(MentionListsContext);
	const query = mentionQuery(menu.text, menu.cursor);
	const reading = query?.kind === "search" ? "every" : query?.kind === "source" ? query.source : null;
	const tickets = ticketsStore.usePolling(null, reading === "every" || reading === "ticket").read?.data.tickets ?? [];
	const inbox = inboxStore.usePolling(null, reading === "every" || reading === "pull-request").read?.data.repos ?? [];
	const sections: MenuSection[] = query
		? mentionMenu({ text: menu.text, cursor: menu.cursor, data: { ...lists, tickets, inbox, sessionId }, changed, files: answer?.items ?? null })
		: answer?.items.length
			? [{ title: null, options: answer.items.map(completionOption) }]
			: [];
	const options = sections.flatMap(section => section.options);
	useLayoutEffect(() => onOptions(options));
	return <CompletionPopup id={id} sections={sections} active={active} error={answer?.error ?? null} onPick={onPick} />;
}
