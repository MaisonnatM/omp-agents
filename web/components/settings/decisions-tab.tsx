/** The Settings Decisions section: the workspace repository's decision records, listed newest first and read one at a time. */
import { useState } from "react";
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

function StatusBadge({ status }: { status: string | null }) {
	if (status === null) return null;
	return (
		<Badge variant="dot" size="compact" color={STATUS_COLORS[status] ?? "gray"} className="shrink-0">
			{status}
		</Badge>
	);
}

/** Record names as buttons that open each record listed here, plain text for one that is not. */
function RecordLinks({ label, names, records, onOpen }: { label: string; names: string[]; records: DecisionRecord[]; onOpen: (name: string) => void }) {
	if (names.length === 0) return null;
	return (
		<p>
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

function RecordView({ record, records, dir, onOpen }: { record: DecisionRecord; records: DecisionRecord[]; dir: string; onOpen: (name: string) => void }) {
	return (
		<article className="flex min-w-0 flex-col gap-3 self-start md:sticky md:top-6" aria-label={record.title}>
			<header className="space-y-1.5">
				<div className="flex items-start gap-2">
					<h3 className="min-w-0 flex-1 text-base font-medium">{record.title}</h3>
					<StatusBadge status={record.status} />
				</div>
				<div className="space-y-0.5 text-xs text-muted-foreground">
					<p>
						{[record.date, record.decisionMakers.length > 0 ? `decided by ${record.decisionMakers.join(", ")}` : null].filter(Boolean).join(" · ")}
						{record.date || record.decisionMakers.length > 0 ? " · " : ""}
						<span className="font-mono">{record.name}.md</span>
					</p>
					<RecordLinks label="Supersedes" names={record.supersedes} records={records} onOpen={onOpen} />
					<RecordLinks label="Superseded by" names={record.supersededBy} records={records} onOpen={onOpen} />
				</div>
			</header>
			<FileBaseContext.Provider value={dir}>
				<div className="text-sm leading-relaxed">
					<MessageMarkdown text={record.body} />
				</div>
			</FileBaseContext.Provider>
		</article>
	);
}

export function DecisionsTab({ cwd, active }: { cwd: string | null; active: boolean }) {
	const read = useRead<DecisionRecords>(active && cwd !== null ? `/api/decisions?cwd=${encodeURIComponent(cwd)}` : null);
	const [selected, setSelected] = useState<string | null>(null);
	const [query, setQuery] = useState("");

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
	const shown = needle ? records.filter(record => `${record.title} ${record.name} ${record.status ?? ""}`.toLowerCase().includes(needle)) : records;
	const open = records.find(record => record.name === selected) ?? shown[0] ?? records[0]!;
	return (
		<div className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
			<nav aria-label="Decision records" className="space-y-2">
				<p className="px-2 text-xs text-muted-foreground">
					{records.length} {records.length === 1 ? "record" : "records"} in {dirDisplay}
				</p>
				<label className="flex h-7 items-center rounded-md border border-border px-2 text-sm">
					<span className="sr-only">Search decision records</span>
					<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" className="w-full bg-transparent outline-none" />
				</label>
				{shown.length === 0 ? <p className="px-2 text-sm text-muted-foreground">No record matches.</p> : null}
				<ul>
					{shown.map(record => (
						<li key={record.name}>
							<button
								type="button"
								aria-current={record === open ? "true" : undefined}
								onClick={() => setSelected(record.name)}
								className={cn(
									"flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
									record === open && "bg-muted",
								)}
							>
								<span className={cn("line-clamp-2", record === open && "font-medium", record.status !== null && record.status !== "accepted" && record.status !== "proposed" && "text-muted-foreground")}>
									{record.title}
								</span>
								<span className="flex items-center gap-2 text-xs text-muted-foreground">
									{record.date}
									<StatusBadge status={record.status} />
								</span>
							</button>
						</li>
					))}
				</ul>
			</nav>
			<RecordView key={open.name} record={open} records={records} dir={dir} onOpen={setSelected} />
		</div>
	);
}
