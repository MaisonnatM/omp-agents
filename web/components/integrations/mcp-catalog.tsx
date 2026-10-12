import { Check, ExternalLink, Plus } from "lucide-react";
import { useId, useState } from "react";
import { MCP_CATALOG, MCP_CATEGORIES, type McpCatalogEntry, type McpCategory } from "../../../src/shared/mcp-catalog";
import type { McpServerRow } from "../../../src/shared/mcp-servers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, putJson } from "../../api";
import { mcpServersStore } from "../../reads";
import { useSignIn } from "../../use-sign-in";
import { MarkTile } from "./integration-row";
import { MCP_LOGOS } from "./mcp-logo-paths";

const refresh = (): Promise<void> => mcpServersStore.refresh();

/** One catalog entry: what it gives, how it signs in, and the button that adds it, or where its sign-in stands once added. */
function CatalogCard({ entry, added }: { entry: McpCatalogEntry; added: McpServerRow | undefined }) {
	const [adding, setAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);
	const add = async (): Promise<McpServerRow> => {
		const row = await putJson<McpServerRow>("/api/mcp-servers/add", { catalog: entry.id });
		await refresh();
		return row;
	};
	// An OAuth entry opens its vendor's sign-in during the click, as Connect does; an open one is just added.
	const { starting, waitingUrl, failure, connect } = useSignIn(added?.signIn ?? null, refresh, async () => (await add()).signIn);

	const addOpen = async (): Promise<void> => {
		setAdding(true);
		setAddError(null);
		try {
			await add();
		} catch (err) {
			setAddError(errorText(err));
		} finally {
			setAdding(false);
		}
	};

	const error = addError ?? failure;
	return (
		<li className="flex flex-col gap-3 rounded-xl bg-surface-3 p-4 shadow-surface-2">
			<div className="flex items-start gap-3">
				<MarkTile logo={MCP_LOGOS[entry.id] ?? null} name={entry.label} />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[13px] font-medium">{entry.label}</h3>
					<p className="text-xs text-muted-foreground">{entry.category}</p>
				</div>
			</div>
			<p className="flex-1 text-[13px] text-pretty text-muted-foreground">{entry.description}</p>
			{error && (
				<p role="alert" className="text-xs text-pretty text-destructive">
					{error}
				</p>
			)}
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">{entry.auth === "oauth" ? "Signs in with OAuth" : "No sign-in"}</span>
				{waitingUrl ? (
					<Button variant="ghost" size="compact" leadingIcon={ExternalLink} render={<a href={waitingUrl} target="_blank" rel="noreferrer" />}>
						Finish sign-in
					</Button>
				) : added ? (
					<span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
						<Check aria-hidden className="size-3.5 shrink-0" />
						<span className="truncate">
							Added as <code className="font-mono">{added.name}</code>
						</span>
					</span>
				) : (
					<Button
						variant="secondary"
						size="compact"
						leadingIcon={Plus}
						loading={starting || adding}
						aria-label={`Add ${entry.label}`}
						onClick={() => void (entry.auth === "oauth" ? connect() : addOpen())}
					>
						Add
					</Button>
				)}
			</div>
		</li>
	);
}

type Filter = McpCategory | "All";

const matches = (entry: McpCatalogEntry, query: string, category: Filter): boolean => {
	const needle = query.trim().toLowerCase();
	return (category === "All" || entry.category === category) && (needle === "" || `${entry.label} ${entry.description} ${entry.category}`.toLowerCase().includes(needle));
};

/** The catalog's servers to add, searchable and by category, each marked once a server on its host is added. */
export function McpCatalog({ servers }: { servers: McpServerRow[] }) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<Filter>("All");
	const headingId = useId();
	const shown = MCP_CATALOG.filter(entry => matches(entry, query, category));
	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3 px-1">
				<h4 id={headingId} className="flex items-baseline gap-2 text-[13px] font-medium">
					Discover
					<span className="text-muted-foreground tabular-nums">{MCP_CATALOG.length}</span>
				</h4>
				<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm">
					<span className="sr-only">Search MCP servers</span>
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" className="w-44 bg-transparent outline-none" />
				</label>
			</div>
			<div role="group" aria-label="Category" className="flex flex-wrap gap-1.5 px-1">
				{(["All", ...MCP_CATEGORIES] as const).map(option => (
					<button
						key={option}
						type="button"
						aria-pressed={category === option}
						onClick={() => setCategory(option)}
						className={cn(
							"h-7 rounded-full px-3 text-xs ring-1 ring-border ring-inset transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none",
							category === option ? "bg-foreground text-background ring-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
						)}
					>
						{option}
					</button>
				))}
			</div>
			{shown.length > 0 ? (
				<ul aria-label="MCP servers to add" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{shown.map(entry => (
						<CatalogCard key={entry.id} entry={entry} added={servers.find(server => server.catalogId === entry.id)} />
					))}
				</ul>
			) : (
				<p className="px-1 text-xs text-muted-foreground">No server matches.</p>
			)}
		</section>
	);
}
