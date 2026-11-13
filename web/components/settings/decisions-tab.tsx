/** The Settings Decisions section: one repository's records, or every workspace's grouped by workspace when All is selected. */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { DecisionRecord, DecisionRecords } from "../../../src/shared/models";
import type { Workspace } from "../../../src/shared/workspaces";
import { errorText } from "../../../src/json";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getJson } from "../../api";
import { useRead } from "../../reads";
import { FileBaseContext } from "../file-link";
import type { FileBase } from "../../file-paths";
import { MessageMarkdown } from "../message-markdown";
import { decisionDomId, decisionGroups, decisionKey, visibleRecords, RETIRED, type DecisionGroup, type DecisionRead } from "./decision-groups";

const STATUS_COLORS: Record<string, "green" | "blue" | "red" | "gray" | "amber"> = {
	accepted: "green",
	proposed: "blue",
	rejected: "red",
	deprecated: "gray",
	superseded: "amber",
};

/** The month a `YYYY-MM-DD` date falls in, as "October 2026", for the timeline's sticky headers. */
function monthOf(date: string | null): string {
	return date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Undated";
}

/** Record names as links that open each record listed here, plain text for one that is not. */
function RecordLinks({ label, names, records, onOpen }: { label: string; names: string[]; records: readonly DecisionRecord[]; onOpen: (name: string) => void }) {
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

function RecordEntry({
	record,
	records,
	dir,
	scope,
	expanded,
	onToggle,
	onOpen,
}: {
	record: DecisionRecord;
	records: readonly DecisionRecord[];
	dir: string;
	/** The workspace cwd when several repositories are listed, so the row id does not collide. `null` for one workspace. */
	scope: string | null;
	expanded: boolean;
	onToggle: () => void;
	onOpen: (name: string) => void;
}) {
	const retired = record.status !== null && RETIRED[record.status] === true;
	const base = useMemo((): FileBase => ({ dir, session: null }), [dir]);
	return (
		<li id={decisionDomId(scope, record.name)} className="grid scroll-mt-10 grid-cols-[6.5rem_minmax(0,1fr)] gap-6 border-b border-border py-6 last:border-b-0">
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
						<FileBaseContext.Provider value={base}>
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

function RecordControls({ query, onQuery, inForce, onInForce }: { query: string; onQuery: (query: string) => void; inForce: boolean; onInForce: (inForce: boolean) => void }) {
	return (
		<div className="mb-2 flex items-center gap-2">
			<label className="flex h-8 flex-1 items-center rounded-md border border-border px-2.5 text-sm focus-within:ring-2 focus-within:ring-ring">
				<span className="sr-only">Search decision records</span>
				<input value={query} onChange={event => onQuery(event.target.value)} placeholder="Search" className="w-full bg-transparent outline-none" />
			</label>
			<div role="group" aria-label="Records shown" className="flex rounded-md border border-border p-0.5 text-xs">
				{[true, false].map(value => (
					<button key={String(value)} type="button" aria-pressed={inForce === value} onClick={() => onInForce(value)} className={cn("rounded px-2 py-1", inForce === value ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
						{value ? "In force" : "All"}
					</button>
				))}
			</div>
		</div>
	);
}

function RecordList({
	shown,
	records,
	dir,
	scope,
	expanded,
	onToggle,
	onOpen,
	sticky,
}: {
	shown: readonly DecisionRecord[];
	records: readonly DecisionRecord[];
	dir: string;
	scope: string | null;
	expanded: ReadonlySet<string>;
	onToggle: (name: string) => void;
	onOpen: (name: string) => void;
	/** Month headers stick in the one-workspace timeline. Across workspaces they would pin over the next workspace. */
	sticky: boolean;
}) {
	return (
		<ol>
			{shown.map((record, i) => {
				const month = monthOf(record.date);
				return (
					<Fragment key={record.name}>
						{i === 0 || monthOf(shown[i - 1]!.date) !== month ? (
							<li aria-hidden className={cn("border-b border-border bg-background py-2 text-xs font-medium text-muted-foreground", sticky && "sticky top-0 z-10")}>
								{month}
							</li>
						) : null}
						<RecordEntry record={record} records={records} dir={dir} scope={scope} expanded={expanded.has(decisionKey(scope, record.name))} onToggle={() => onToggle(record.name)} onOpen={onOpen} />
					</Fragment>
				);
			})}
		</ol>
	);
}

/** Each workspace's records, fetched only while All is selected. `null` until that read settles. */
function useDecisionReads(workspaces: readonly Workspace[] | null): DecisionRead[] | null {
	const key = workspaces?.map(workspace => `${workspace.cwd}\0${workspace.cwdDisplay}`).join("\n") ?? "";
	const listed = useRef(workspaces);
	listed.current = workspaces;
	const [state, setState] = useState<{ key: string; reads: DecisionRead[] } | null>(null);
	useEffect(() => {
		const list = listed.current;
		if (list === null) return;
		const controller = new AbortController();
		Promise.all(
			list.map(async (workspace): Promise<DecisionRead> => {
				try {
					const data = await getJson<DecisionRecords>(`/api/decisions?cwd=${encodeURIComponent(workspace.cwd)}`, controller.signal);
					return { cwd: workspace.cwd, cwdDisplay: workspace.cwdDisplay, data, error: null };
				} catch (err) {
					if (controller.signal.aborted) throw err;
					return { cwd: workspace.cwd, cwdDisplay: workspace.cwdDisplay, data: null, error: errorText(err) };
				}
			}),
		).then(
			reads => {
				if (!controller.signal.aborted) setState({ key, reads });
			},
			() => undefined,
		);
		return () => controller.abort();
	}, [key]);
	if (workspaces === null) return null;
	return state?.key === key ? state.reads : null;
}

function AllDecisions({
	workspaces,
	reads,
	query,
	onQuery,
	inForce,
	onInForce,
	expanded,
	onToggle,
	onOpen,
}: {
	workspaces: readonly Workspace[];
	reads: DecisionRead[] | null;
	query: string;
	onQuery: (query: string) => void;
	inForce: boolean;
	onInForce: (inForce: boolean) => void;
	expanded: ReadonlySet<string>;
	onToggle: (scope: string, name: string) => void;
	onOpen: (scope: string, name: string) => void;
}) {
	if (workspaces.length === 0) return <p className="text-sm text-muted-foreground">No workspace yet.</p>;
	if (reads === null) return <p className="text-sm text-muted-foreground">Reading decision records…</p>;
	const { groups, empty } = decisionGroups(reads);
	const loaded = groups.filter((group): group is Extract<DecisionGroup, { error: null }> => group.error === null);
	const failed = groups.filter((group): group is Extract<DecisionGroup, { error: string }> => group.error !== null);
	const sections = loaded.map(group => ({ group, ...visibleRecords(group.records, query, inForce) }));
	const visible = sections.filter(section => section.shown.length > 0);
	const hidden = sections.reduce((sum, section) => sum + section.hidden, 0);
	const total = loaded.reduce((sum, group) => sum + group.records.length, 0);
	return (
		<div className="mx-auto max-w-3xl">
			{loaded.length > 0 ? (
				<p className="mb-2 text-xs text-muted-foreground">
					{total} {total === 1 ? "record" : "records"} in {loaded.length} {loaded.length === 1 ? "workspace" : "workspaces"}
				</p>
			) : null}
			{empty > 0 && loaded.length > 0 ? (
				<p className="mb-2 text-xs text-muted-foreground">
					{empty} {empty === 1 ? "workspace keeps" : "workspaces keep"} no decision records.
				</p>
			) : null}
			{loaded.length > 0 ? <RecordControls query={query} onQuery={onQuery} inForce={inForce} onInForce={onInForce} /> : null}
			{failed.map(group => (
				<section key={group.cwd} aria-label={group.cwdDisplay} className="mt-8 first:mt-0">
					<h2 className="border-b border-border pb-2 text-sm font-medium">{group.cwdDisplay}</h2>
					<p role="alert" className="py-3 text-sm text-red-600 dark:text-red-400">
						Cannot read the decision records: {group.error}
					</p>
				</section>
			))}
			{loaded.length === 0 && failed.length === 0 ? <p className="text-sm text-muted-foreground">None of these workspaces keep decision records.</p> : null}
			{loaded.length > 0 && visible.length === 0 && hidden === 0 ? <p className="py-6 text-sm text-muted-foreground">No record matches.</p> : null}
			{visible.map(({ group, shown }) => (
				<section key={group.cwd} aria-label={group.cwdDisplay} className="mt-8 first:mt-0">
					<h2 className="flex items-baseline gap-2 border-b border-border pb-2 text-sm">
						<span className="font-medium">{group.cwdDisplay}</span>
						<span className="text-muted-foreground tabular-nums">{group.records.length === 1 ? "1 record" : `${group.records.length} records`}</span>
					</h2>
					<RecordList shown={shown} records={group.records} dir={group.dir} scope={group.cwd} expanded={expanded} onToggle={name => onToggle(group.cwd, name)} onOpen={name => onOpen(group.cwd, name)} sticky={false} />
				</section>
			))}
			{hidden > 0 ? (
				<button type="button" onClick={() => onInForce(false)} className="mt-2 w-full rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-muted">
					Show {hidden} superseded, deprecated, or rejected {hidden === 1 ? "record" : "records"}
				</button>
			) : null}
		</div>
	);
}

export function DecisionsTab({ cwd, workspaces, active }: { cwd: string | null; workspaces: readonly Workspace[]; active: boolean }) {
	const read = useRead<DecisionRecords>(active && cwd !== null ? `/api/decisions?cwd=${encodeURIComponent(cwd)}` : null);
	const reads = useDecisionReads(active && cwd === null ? workspaces : null);
	const [query, setQuery] = useState("");
	const [inForce, setInForce] = useState(true);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const toggle = (scope: string | null, name: string) =>
		setExpanded(current => {
			const next = new Set(current);
			const key = decisionKey(scope, name);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	// A supersede link shows every record, opens the one it names, and scrolls to it. `scope` keeps that inside one repository.
	const open = (scope: string | null, name: string) => {
		setInForce(false);
		setExpanded(current => new Set(current).add(decisionKey(scope, name)));
		requestAnimationFrame(() => document.getElementById(decisionDomId(scope, name))?.scrollIntoView({ behavior: "smooth", block: "start" }));
	};

	if (cwd === null) {
		if (!active) return null;
		return (
			<AllDecisions
				workspaces={workspaces}
				reads={reads}
				query={query}
				onQuery={setQuery}
				inForce={inForce}
				onInForce={setInForce}
				expanded={expanded}
				onToggle={(scope, name) => toggle(scope, name)}
				onOpen={(scope, name) => open(scope, name)}
			/>
		);
	}
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
	const { shown, hidden } = visibleRecords(records, query, inForce);

	return (
		<div className="mx-auto max-w-3xl">
			<p className="mb-2 text-xs text-muted-foreground">
				{records.length} {records.length === 1 ? "record" : "records"} in {dirDisplay}
			</p>
			<RecordControls query={query} onQuery={setQuery} inForce={inForce} onInForce={setInForce} />
			{shown.length === 0 && hidden === 0 ? <p className="py-6 text-sm text-muted-foreground">No record matches.</p> : null}
			<RecordList shown={shown} records={records} dir={dir} scope={null} expanded={expanded} onToggle={name => toggle(null, name)} onOpen={name => open(null, name)} sticky />
			{hidden > 0 ? (
				<button type="button" onClick={() => setInForce(false)} className="mt-2 w-full rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-muted">
					Show {hidden} superseded, deprecated, or rejected {hidden === 1 ? "record" : "records"}
				</button>
			) : null}
		</div>
	);
}
