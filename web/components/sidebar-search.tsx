import { Search } from "lucide-react";
import { useRef } from "react";
import { SidebarInput } from "@/components/ui/sidebar";
import { type ShortcutId, shortcutLabels, useShortcuts } from "../shortcuts";
import { Kbd } from "./command-palette/palette-footer";

interface SidebarSearchProps {
	label: string;
	placeholder: string;
	query: string;
	onQuery: (query: string) => void;
	/** The shortcut that puts the cursor in the field, whose key the empty field shows on its right. */
	shortcut?: ShortcutId;
}

/** A sidebar list's search field; Esc clears it and leaves it. */
export function SidebarSearch({ label, placeholder, query, onQuery, shortcut }: SidebarSearchProps) {
	const ref = useRef<HTMLInputElement>(null);
	const focusField = (): boolean => {
		const input = ref.current;
		// A hidden tab or sidebar leaves the key its usual meaning, such as the browser's Find.
		if (!input?.checkVisibility()) return false;
		input.focus();
		input.select();
		return true;
	};
	useShortcuts(shortcut ? { [shortcut]: focusField } : {});
	const chip = shortcut !== undefined && query === "";
	return (
		<label className="relative block">
			<Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<SidebarInput
				ref={ref}
				type="search"
				aria-label={label}
				placeholder={placeholder}
				value={query}
				onChange={event => onQuery(event.target.value)}
				onKeyDown={event => {
					if (event.key !== "Escape") return;
					onQuery("");
					event.currentTarget.blur();
				}}
				className={chip ? "pr-14 pl-8" : "pl-8"}
			/>
			{chip && (
				<Kbd aria-hidden className="pointer-events-none absolute top-1/2 right-2 h-5 min-w-5 -translate-y-1/2 px-1 text-[11px]">
					{shortcutLabels(shortcut)[0]}
				</Kbd>
			)}
		</label>
	);
}
