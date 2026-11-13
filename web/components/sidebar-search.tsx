import { IconMagnifyingGlass } from "central-icons";
import { useRef } from "react";
import { SidebarInput } from "@/components/ui/sidebar";
import { type ShortcutId, useShortcuts } from "../shortcuts";
import { ShortcutChip } from "./kbd";

interface SidebarSearchProps {
	label: string;
	placeholder: string;
	query: string;
	onQuery: (query: string) => void;
	/** The shortcut that puts the cursor in the field, whose key the empty field shows on its right. */
	shortcut?: ShortcutId;
	/** Puts the cursor in the field when it mounts. */
	autoFocus?: boolean;
	/** Called when the cursor leaves the field. */
	onLeave?: () => void;
}

/** A sidebar list's search field; Esc clears it and leaves it. */
export function SidebarSearch({ label, placeholder, query, onQuery, shortcut, autoFocus, onLeave }: SidebarSearchProps) {
	const ref = useRef<HTMLInputElement>(null);
	const focusField = (): boolean => {
		const input = ref.current;
		input?.focus();
		// A hidden tab, a sliding or hidden sidebar, or an open dialog keeps focus away, and the key keeps its usual meaning, such as the browser's Find.
		if (!input || document.activeElement !== input) return false;
		input.select();
		return true;
	};
	useShortcuts(shortcut ? { [shortcut]: focusField } : {});
	const chip = shortcut !== undefined && query === "";
	return (
		<label className="relative block">
			<IconMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<SidebarInput
				ref={ref}
				type="search"
				aria-label={label}
				placeholder={placeholder}
				value={query}
				autoFocus={autoFocus}
				onChange={event => onQuery(event.target.value)}
				onBlur={onLeave}
				onKeyDown={event => {
					if (event.key !== "Escape") return;
					onQuery("");
					event.currentTarget.blur();
				}}
				className={chip ? "pr-14 pl-8" : "pl-8"}
			/>
			{chip && <ShortcutChip id={shortcut} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2" />}
		</label>
	);
}
