/** The Settings Decisions section: the workspace repository's decision records as a timeline, newest first, the ones in force by default. */
import { Fragment, useState } from "react";
import type { DecisionRecord, DecisionRecords } from "../../../src/shared/models";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRead } from "../../reads";
import { FileBaseContext } from "../file-link";
import { MessageMarkdown } from "../message-markdown";

const STATUS_COLORS: Record<string, "green" | "blue" | "red" | "gray" | "amber"> = {
	accepted: "green",
	proposed: "blue",
	rejected: "red",
	deprecated: "gray",
	superseded: "amber",
};
/** Statuses of a record that no longer applies, which **In force** hides. */
const RETIRED: Record<string, true> = { superseded: true, deprecated: true, rejected: true };

/** The month a `YYYY-MM-DD` date falls in, as "October 2026", for the timeline's sticky headers. */
function monthOf(date: string | null): string {
	return date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Undated";
}

/** Record names as links that open each record listed here, plain text for one that is not. */
function RecordLinks({ label, names, records, onOpen }: { label: string; names: string[]; records: DecisionRecord[]; onOpen: (name: string) => void }) {
	if (names.length === 0) return null;
	return (
		<p className="text-xs text-muted-foreground">
			{label}{" "}
			{names.map((name, i) => {
				const title = records.find(record => record.name === name)?.title;
				return (
					<span key={name}>
						{i > 0 && ", "}
						{title === undefined ? (
							<span className="font-mono">{name}</span>
						) : (
							<button type="button" onClick={() => onOpen(name)} className="text-foreground underline underline-offset-2 hover:text-primary">
								{title}
							</button>
						)}
					</span>
				);
			})}
		</p>
	);
}

function RecordEntry({ record, records, dir, expanded, onToggle, onOpen }: { record: DecisionRecord; records: DecisionRecord[]; dir: string; expanded: boolean; onToggle: () => void; onOpen: (name: string) => void }) {
	const retired = record.status !== null && RETIRED[record.status] === true;
	return (
		<li id={`decision-${record.name}`} className="grid scroll-mt-10 grid-cols-[6.5rem_minmax(0,1fr)] gap-6 border-b border-border py-6 last:border-b-0">
			<time className="pt-0.5 text-xs tabular-nums text-muted-foreground">{record.date}</time>
			<article className="min-w-0 space-y-2" aria-label={record.title}>
				{record.status !== null ? (
					<Badge variant="dot" size="compact" color={STATUS_COLORS[record.status] ?? "gray"}>
						{record.status}
					</Badge>
				) : null}
				<h3 className={cn("text-[15px] font-semibold", retired && "text-muted-foreground line-through")}>{record.title}</h3>
				<RecordLinks label="Supersedes" names={record.supersedes} records={records} onOpen={onOpen} />
				<RecordLinks label="Superseded by" names={record.supersededBy} records={records} onOpen={onOpen} />
				{expanded ? (
					<>
						<p className="text-xs text-muted-foreground">
							{record.decisionMakers.length > 0 ? `Decided by ${record.decisionMakers.join(", ")} · ` : ""}
							<span className="font-mono">{record.name}.md</span>
						</p>
						<FileBaseContext.Provider value={dir}>
							<div className="text-sm leading-relaxed">
								<MessageMarkdown text={record.body} />
							</div>
						</FileBaseContext.Provider>
					</>
				) : (
					// The first paragraph as plain text, since three clamped lines cut Markdown mid-syntax.
					<p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{(record.body.split(/\n\s*\n/)[0] ?? "").replace(/[`*_]/g, "")}</p>
				)}
				<button type="button" onClick={onToggle} aria-expanded={expanded} className="text-xs font-medium underline-offset-2 hover:underline">
					{expanded ? "Show less" : "Read the record"}
				</button>
			</article>
		</li>
	);
}

export function DecisionsTab({ cwd, active }: { cwd: string | null; active: boolean }) {
	const read = useRead<DecisionRecords>(active && cwd !== null ? `/api/decisions?cwd=${encodeURIComponent(cwd)}` : null);
	const [query, setQuery] = useState("");
	const [inForce, setInForce] = useState(true);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

	if (cwd === null) return <p className="text-sm text-muted-foreground">Pick a workspace to read its repository's decision records.</p>;
	if (read.error !== null && read.data === null) {
		return (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot read the decision records: {read.error}
			</p>
		);
	}
	if (read.data === null) return <p className="text-sm text-muted-foreground">{active ? "Reading decision records…" : ""}</p>;
	const { dir, dirDisplay, records } = read.data;
	if (dir === null) {
		return (
			<p className="text-sm text-muted-foreground">
				This repository keeps no decision records. Agents add them to <code>docs/decisions/</code> as the <code>decision-records</code> skill says.
			</p>
		);
	}
	if (records.length === 0) return <p className="text-sm text-muted-foreground">{dirDisplay} holds no records yet.</p>;

	const needle = query.trim().toLowerCase();
	const matching = needle ? records.filter(record => `${record.title} ${record.name} ${record.status ?? ""} ${record.body}`.toLowerCase().includes(needle)) : records;
	const shown = inForce ? matching.filter(record => record.status === null || RETIRED[record.status] !== true) : matching;
	const hidden = matching.length - shown.length;
	const toggle = (name: string) =>
		setExpanded(current => {
			const next = new Set(current);
			if (!next.delete(name)) next.add(name);
			return next;
		});
	// A supersede link shows every record, opens the one it names, and scrolls to it.
	const open = (name: string) => {
		setInForce(false);
		setExpanded(current => new Set(current).add(name));
		requestAnimationFrame(() => document.getElementById(`decision-${name}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
	};

	return (
		<div className="mx-auto max-w-3xl">
			<p className="mb-2 text-xs text-muted-foreground">
				{records.length} {records.length === 1 ? "record" : "records"} in {dirDisplay}
			</p>
			<div className="mb-2 flex items-center gap-2">
				<label className="flex h-8 flex-1 items-center rounded-md border border-border px-2.5 text-sm focus-within:ring-2 focus-within:ring-ring">
					<span className="sr-only">Search decision records</span>
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" className="w-full bg-transparent outline-none" />
				</label>
				<div role="group" aria-label="Records shown" className="flex rounded-md border border-border p-0.5 text-xs">
					{[true, false].map(value => (
						<button key={String(value)} type="button" aria-pressed={inForce === value} onClick={() => setInForce(value)} className={cn("rounded px-2 py-1", inForce === value ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
							{value ? "In force" : "All"}
						</button>
					))}
				</div>
			</div>
			{shown.length === 0 && hidden === 0 ? <p className="py-6 text-sm text-muted-foreground">No record matches.</p> : null}
			<ol>
				{shown.map((record, i) => {
					const month = monthOf(record.date);
					return (
						<Fragment key={record.name}>
							{i === 0 || monthOf(shown[i - 1]!.date) !== month ? (
								<li aria-hidden className="sticky top-0 z-10 border-b border-border bg-background py-2 text-xs font-medium text-muted-foreground">
									{month}
								</li>
							) : null}
							<RecordEntry record={record} records={records} dir={dir} expanded={expanded.has(record.name)} onToggle={() => toggle(record.name)} onOpen={open} />
						</Fragment>
					);
				})}
			</ol>
			{hidden > 0 ? (
				<button type="button" onClick={() => setInForce(false)} className="mt-2 w-full rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-muted">
					Show {hidden} superseded, deprecated, or rejected {hidden === 1 ? "record" : "records"}
				</button>
			) : null}
		</div>
	);
}
