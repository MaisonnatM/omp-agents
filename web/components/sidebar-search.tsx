import { Search } from "lucide-react";
import { SidebarInput } from "@/components/ui/sidebar";

/** A sidebar list's search field; Esc clears it and leaves it. */
export function SidebarSearch({ label, placeholder, query, onQuery }: { label: string; placeholder: string; query: string; onQuery: (query: string) => void }) {
	return (
		<label className="relative block">
			<Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<SidebarInput
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
				className="pl-8"
			/>
		</label>
	);
}
