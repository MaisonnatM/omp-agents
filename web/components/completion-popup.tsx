import { File, Folder, Slash, Sparkles } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type TextareaHTMLAttributes, useId, useRef, useState } from "react";
import type { CompletionItem } from "../../src/shared";
import { completionTrigger } from "../completion-trigger";
import type { Completions } from "../pane-store";

const ICON = { command: Slash, skill: Sparkles, file: File, directory: Folder };

export function CompletionPopup({ id, items, active, onPick, error }: {
	id: string;
	items: CompletionItem[];
	active: number;
	onPick: (item: CompletionItem) => void;
	error: string | null;
}) {
	return (
		<div className="absolute inset-x-6 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" aria-label="Completions">
		<div id={id} role="listbox" aria-label="Suggestions" className="max-h-64 overflow-y-auto p-1">
			{items.map((item, index) => {
				const Icon = ICON[item.kind];
				return (
					<div
						key={`${item.kind}:${item.label}:${index}`}
						id={`${id}-${index}`}
						role="option"
						aria-selected={index === active}
						className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
						onMouseDown={event => event.preventDefault()}
						onClick={() => onPick(item)}
					>
						<Icon size={16} aria-hidden="true" />
						<span className="min-w-0 flex-1 truncate">{item.label}</span>
						{item.description && <span className="max-w-[45%] truncate text-xs opacity-70">{item.description}</span>}
						</div>
				);
			})}
			{!items.length && <p className="px-3 py-2 text-xs text-muted-foreground">{error ?? "No matches"}</p>}
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
 * omp's `/` and `@` completion for a composer: suggestions follow the caret, and the open list owns Esc, the arrows,
 * Tab, and Enter. Live sessions and the new-session draft share it, so both offer the same commands and skills.
 */
export function useCompletion({ draft, setDraft, completions, onComplete, onKeyDown }: CompletionOptions): Completion {
	const [requestId, setRequestId] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const nextId = useRef(0);
	const composerRef = useRef<HTMLDivElement>(null);
	const popupId = useId();

	const answer = requestId !== null && completions?.reqId === requestId ? completions : null;
	const suggestions = answer?.items ?? [];
	const popupOpen = requestId !== null;
	const shown = Math.min(active, suggestions.length - 1);
	const suggest = (text: string, cursor: number): void => {
		if (!completionTrigger(text, cursor)) {
			setRequestId(null);
			return;
		}
		const id = ++nextId.current;
		setRequestId(id);
		setActive(0);
		onComplete(id, text, cursor);
	};
	const pick = (item: CompletionItem): void => {
		setDraft(item.text);
		setRequestId(null);
		requestAnimationFrame(() => {
			const el = composerRef.current?.querySelector("textarea");
			el?.focus();
			el?.setSelectionRange(item.cursor, item.cursor);
		});
	};

	return {
		composerRef,
		popup: popupOpen && <CompletionPopup id={popupId} items={suggestions} active={shown} error={answer?.error ?? null} onPick={pick} />,
		onValueChange: text => {
			setDraft(text);
			suggest(text, composerRef.current?.querySelector("textarea")?.selectionStart ?? text.length);
		},
		textareaProps: {
			"aria-controls": popupOpen ? popupId : undefined,
			"aria-expanded": popupOpen,
			"aria-autocomplete": "list",
			"aria-activedescendant": popupOpen && suggestions.length ? `${popupId}-${shown}` : undefined,
			onClick: event => suggest(draft, event.currentTarget.selectionStart),
			onKeyUp: event => {
				if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) suggest(draft, event.currentTarget.selectionStart);
			},
			onKeyDown: event => {
				if (!popupOpen || event.nativeEvent.isComposing) return onKeyDown?.(event);
				if (event.key === "Escape") {
					event.preventDefault();
					setRequestId(null);
				} else if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
					event.preventDefault();
					setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
				} else if (suggestions.length && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
					event.preventDefault();
					pick(suggestions[shown]);
				}
			},
		},
		close: () => setRequestId(null),
	};
}
