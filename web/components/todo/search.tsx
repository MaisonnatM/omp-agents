import { Search } from "lucide-react";
import { useRef } from "react";
import { useShortcuts } from "../../shortcuts";

/** The Todo page's search field, which `/` focuses outside a text field and Esc clears. */
export function TodoSearch({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
	const ref = useRef<HTMLInputElement>(null);
	useShortcuts({ todoSearch: () => ref.current?.focus() });
	return (
		<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring [&>svg]:size-3.5">
			<Search aria-hidden />
			<input
				ref={ref}
				type="search"
				aria-label="Search todos"
				placeholder="Search"
				value={query}
				onChange={event => onQuery(event.target.value)}
				onKeyDown={event => {
					if (event.key !== "Escape") return;
					onQuery("");
					event.currentTarget.blur();
				}}
				className="w-32 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
			/>
		</label>
	);
}
