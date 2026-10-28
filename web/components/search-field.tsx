import { Search } from "lucide-react";
import type { Ref } from "react";
import { cn } from "@/lib/utils";

interface SearchFieldProps {
	/** The field's accessible name. */
	label: string;
	placeholder: string;
	query: string;
	onQuery: (query: string) => void;
	/** The input's width classes. */
	className?: string;
	ref?: Ref<HTMLInputElement>;
}

/** A bordered search field with a magnifier; Escape clears it and leaves it. */
export function SearchField({ label, placeholder, query, onQuery, className, ref }: SearchFieldProps) {
	return (
		<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring [&>svg]:size-3.5">
			<Search aria-hidden />
			<input
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
				className={cn("bg-transparent text-foreground outline-none placeholder:text-muted-foreground", className)}
			/>
		</label>
	);
}
