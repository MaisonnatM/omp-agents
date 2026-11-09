import { useRef } from "react";
import { useShortcuts } from "../../shortcuts";
import { SearchField } from "../search-field";

/** The Todo page's search field, which `/` focuses outside a text field and Esc clears. */
export function TodoSearch({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
	const ref = useRef<HTMLInputElement>(null);
	useShortcuts({ todoSearch: () => ref.current?.focus() });
	return <SearchField ref={ref} label="Search todos" placeholder="Search" query={query} onQuery={onQuery} className="w-32" />;
}
