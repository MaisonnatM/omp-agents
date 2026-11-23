/** The composer's completion popup for skills, commands, files, and other mentions, and the `useCompletion` hook that drives it. */
import { IconChevronRightSmall } from "central-icons";
import { type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { completionTrigger, type Trigger } from "../completion-trigger";
import { type Composer, completionOption, fileSearch, mentionMenu, type MenuOption, type MenuSection, } from "../mentions";
import type { Completions } from "../pane-store";
import { useSearchedPullRequests } from "../reads";
import { useDashboardStatus, useMentionLists } from "./dashboard-context";
import type { PromptEditorHandle } from "./prompt-editor";

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
									{...activityControl("completion.pick")}
									key={optionIndex}
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
									{option.opens && <IconChevronRightSmall size={14} aria-hidden="true" className="opacity-70" />}
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

interface MenuSource<T> {
	/** The composer's text field, whose caret the suggestions follow; the caller owns it, so the keys it handles can reach it before this hook runs. */
	editorRef: RefObject<PromptEditorHandle | null>;
	draft: string;
	setDraft: (text: string) => void;
	/** What the text before `cursor` opens, or `null` for no list; it may send the request whose answer `list` shows. */
	open: (text: string, cursor: number) => T | null;
	/** The open list's sections, and what to say when it has none. */
	list: (menu: T) => { sections: MenuSection[]; error: string | null };
}

interface Completion {
	/** The open list, placed just before the composer, above it. */
	popup: ReactNode;
	onValueChange: (text: string) => void;
	editorProps: HTMLAttributes<HTMLDivElement>;
	/**
	 * Runs the open list's keys: Esc, the arrows, Tab, and Enter. Returns whether the list owns the key, so the composer's
	 * own keys run only when it does not: while no list is open, during composition, and for Shift+Tab.
	 */
	onMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
	close: () => void;
}

/**
 * A composer's completion list, whatever it completes: suggestions follow the caret, and the open list owns Esc, the
 * arrows, Tab, and Enter. Sessions use it through `useCompletion`, and the Board with its members and commands.
 */
export function useCompletionMenu<T>({ editorRef, draft, setDraft, open, list }: MenuSource<T>): Completion {
	const [menu, setMenu] = useState<T | null>(null);
	const [active, setActive] = useState(0);
	const popupId = useId();
	const { sections, error } = menu === null ? { sections: [], error: null } : list(menu);
	const options = sections.flatMap(section => section.options);
	const shown = Math.min(active, options.length - 1);

	const suggest = (text: string, cursor: number): void => {
		const next = open(text, cursor);
		setMenu(next);
		if (next !== null) setActive(0);
	};
	const pick = ({ edit, opens }: MenuOption): void => {
		setDraft(edit.text);
		if (opens) suggest(edit.text, edit.cursor);
		else setMenu(null);
		requestAnimationFrame(() => editorRef.current?.select(edit.cursor));
	};

	const caret = (): number => editorRef.current?.selection().start ?? draft.length;
	return {
		popup: menu !== null && <CompletionPopup id={popupId} sections={sections} active={shown} error={error} onPick={pick} />,
		onValueChange: text => {
			setDraft(text);
			suggest(text, editorRef.current?.selection().start ?? text.length);
		},
		editorProps: {
			"aria-controls": menu !== null ? popupId : undefined,
			"aria-expanded": menu !== null,
			"aria-autocomplete": "list",
			"aria-activedescendant": menu !== null && options.length ? `${popupId}-${shown}` : undefined,
			// The editor takes a click's caret on the next frame.
			onClick: () => requestAnimationFrame(() => suggest(draft, caret())),
			onKeyUp: event => {
				if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) suggest(draft, caret());
			},
		},
		onMenuKeyDown: event => {
			if (menu === null || event.nativeEvent.isComposing || (event.key === "Tab" && event.shiftKey)) return false;
			if (event.key === "Escape") {
				event.preventDefault();
				setMenu(null);
			} else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
				event.preventDefault();
				setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
			} else if (options.length && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
				event.preventDefault();
				pick(options[shown]);
			}
			return true;
		},
		close: () => setMenu(null),
	};
}

interface CompletionOptions extends Pick<MenuSource<unknown>, "editorRef" | "draft" | "setDraft"> {
	/** The server's last answer to this composer's `complete`. */
	completions: Completions | null;
	onComplete: (reqId: number, text: string, cursor: number) => void;
	composer: Composer;
}

/**
 * omp's commands behind `/`, its skills behind `$`, and the `@` menu, for a composer. Live sessions, the new-session
 * draft, and a Bot's composer share it, so all offer the same commands and skills. The `@` menu adds todos, pull
 * requests, people, and sessions to omp's files; it asks the server only for files.
 */
export function useCompletion({ editorRef, draft, setDraft, completions, onComplete, composer }: CompletionOptions): Completion {
	const nextId = useRef(0);
	const lists = useMentionLists();
	const { pullRequestsScope } = useDashboardStatus();
	const pullRequestRepos = useSearchedPullRequests(pullRequestsScope);
	// The open list keeps what opened it, and the `complete` request whose answer it shows, if it sent one.
	return useCompletionMenu<{ trigger: Trigger; reqId: number | null }>({
		editorRef,
		draft,
		setDraft,
		open: (text, cursor) => {
			const trigger = completionTrigger(text, cursor);
			if (!trigger) return null;
			// omp completes skills as `/skill:<name>`; its answer's edit puts that where the `$` was.
			const request =
				trigger.kind === "mention"
					? fileSearch(text, trigger.token)
					: trigger.kind === "skill"
						? { text: `${text.slice(0, trigger.start)}/skill:${text.slice(trigger.start + 1)}`, cursor: cursor + "skill:".length }
						: { text, cursor };
			const reqId = request ? ++nextId.current : null;
			if (request && reqId !== null) onComplete(reqId, request.text, request.cursor);
			return { trigger, reqId };
		},
		list: ({ trigger, reqId }) => {
			const answer = completions && completions.reqId === reqId ? completions : null;
			if (trigger.kind === "mention") return { sections: mentionMenu({ text: draft, token: trigger.token, data: { ...lists, pullRequestRepos }, composer, files: answer?.items ?? null }), error: answer?.error ?? null };
			// omp answers `/` with a `skill:` row besides its commands, and `/skill:` with skills only; each list keeps its own kind.
			const items = (answer?.items ?? []).filter(item => item.kind === trigger.kind);
			return { sections: items.length ? [{ title: null, options: items.map(completionOption) }] : [], error: answer?.error ?? null };
		},
	});
}
