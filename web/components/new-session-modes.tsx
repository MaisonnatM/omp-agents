/** What the New session page shows under the composer in place of its starters: a private draft's facts of what ending it deletes, and a personal draft's memory and sessions to resume. */
import { Brain, FileCode, History, Lock, type LucideIcon, Trash2, UserRound } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { PastSession } from "../../src/shared/sessions";
import { cn } from "@/lib/utils";
import { memoryEntries } from "../bots-model";
import { pastLabel } from "../labels";
import { workspaceCwd } from "../sessions";
import { Age } from "./age";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";

/** How many rows each of the personal draft's columns shows. */
const ROWS = 4;

/** The omp sessions, which alone resume, in `cwd`: interrupted first, then the latest. */
export function resumable(past: PastSession[], cwd: string): PastSession[] {
	return past
		.filter(session => session.source === "omp" && workspaceCwd(session) === cwd)
		.toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted) || b.modifiedAt - a.modifiedAt);
}

/** A private draft's facts: what ending it deletes, and what stays. */
export function PrivateFacts({ personal }: { personal: boolean }) {
	const facts: { icon: LucideIcon; title: string; text: string }[] = [
		{ icon: History, title: "Not in Past sessions", text: "It never shows there, and you cannot resume it." },
		{ icon: Trash2, title: "Deleted when it ends", text: "Its conversation, its subagents, and its prompts in history go with it." },
		personal
			? { icon: Brain, title: "Memory stays on", text: "It still reads what it knows about you and can add to it." }
			: { icon: FileCode, title: "Your files stay", text: "Files it changes and commits it makes stay in the project." },
	];
	return (
		<section aria-label="What a private session keeps" className="mt-4">
			<ModeHeading icon={Lock} title={personal ? "Private, personal" : "Private session"} />
			<ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{facts.map(({ icon: Icon, title, text }) => (
					<li key={title} className="rounded-xl bg-card/80 p-3 shadow-surface-2">
						<p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
							<Icon aria-hidden className="size-3.5 text-muted-foreground" />
							{title}
						</p>
						<p className="text-xs text-pretty text-muted-foreground">{text}</p>
					</li>
				))}
			</ul>
		</section>
	);
}

interface PersonalPanelProps {
	/** The personal directory. */
	cwd: string;
	past: PastSession[];
	/** `personal-memory.md`'s text. */
	memory: string;
}

/** A personal draft's panel: the facts every personal session shares, newest first, and the personal sessions to resume. */
export function PersonalPanel({ cwd, past, memory }: PersonalPanelProps) {
	const { starts } = useDashboardStatus();
	const facts = useMemo(() => memoryEntries(memory).toReversed(), [memory]);
	const sessions = useMemo(() => resumable(past, cwd), [past, cwd]);
	const resuming = starts.resume?.phase === "starting" ? starts.resume.op.sessionId : null;
	return (
		<section aria-label="Your assistant" className="mt-4">
			<ModeHeading icon={UserRound} title="Your assistant" note="For meals, shopping, plans, and everything outside code. It remembers what you tell it about yourself." />
			<div className="grid grid-cols-1 rounded-[18px] bg-card/80 shadow-surface-3 md:grid-cols-[1.3fr_1fr] [&>*+*]:border-t [&>*+*]:border-border md:[&>*+*]:border-t-0 md:[&>*+*]:border-s">
				<Column icon={Brain} title="What it remembers" count={facts.length} empty="Nothing yet. Tell it something worth keeping, and it remembers it.">
					{facts.slice(0, ROWS).map((entry, index) => (
						<li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-2.5 py-[9px]">
							<span className="truncate text-[13.5px]">{entry.fact}</span>
							{entry.date && <span className="text-[11.5px] tabular-nums text-muted-foreground">{entry.date}</span>}
						</li>
					))}
				</Column>
				<Column icon={History} title="Recent" count={sessions.length} empty="No personal sessions yet.">
					{sessions.slice(0, ROWS).map(session => (
						<ResumeRow key={session.sessionId} session={session} resuming={resuming} />
					))}
				</Column>
			</div>
		</section>
	);
}

function ModeHeading({ icon: Icon, title, note }: { icon: LucideIcon; title: string; note?: string }) {
	return (
		<div className="mb-2 px-1">
			<h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
				<Icon aria-hidden className="size-3.5 text-muted-foreground" />
				{title}
			</h2>
			{note && <p className="text-xs text-pretty text-muted-foreground">{note}</p>}
		</div>
	);
}

function Column({ icon: Icon, title, count, empty, children }: { icon: LucideIcon; title: string; count: number; empty: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1 p-2.5">
			<header className="flex items-center gap-2 px-2.5 pt-1 pb-1.5 text-[13px]">
				<Icon aria-hidden className="size-3.5 text-muted-foreground" />
				<h3 className="font-semibold">{title}</h3>
				<span className="tabular-nums text-muted-foreground">{count}</span>
			</header>
			{count > 0 ? <ul className="flex flex-col">{children}</ul> : <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{empty}</p>}
		</div>
	);
}

function ResumeRow({ session, resuming }: { session: PastSession; resuming: string | null }) {
	const { start } = useDashboardActions();
	const busy = resuming === session.sessionId;
	return (
		<li>
			<button
				type="button"
				disabled={resuming !== null}
				aria-busy={busy || undefined}
				onClick={() => start({ kind: "resume", sessionId: session.sessionId })}
				className="group/row grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[10px] px-2.5 py-[9px] text-left outline-none transition-[background-color,scale] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] active:bg-active disabled:opacity-60 motion-reduce:transition-none"
			>
				<span className="row-span-2 flex justify-center">
					<span aria-hidden className={cn("size-2 rounded-full", session.interrupted ? "bg-amber-500" : "bg-muted-foreground/40")} />
				</span>
				<span className="truncate text-[13.5px] font-medium">{pastLabel(session)}</span>
				<span className={cn("row-span-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100 [@media(hover:none)]:opacity-100", busy && "opacity-100 motion-safe:animate-pulse")}>
					{busy ? "Resuming…" : "Resume"} →
				</span>
				<span className="truncate text-[11.5px] text-muted-foreground">
					{session.interrupted ? "Interrupted" : "Ended"} · <Age at={session.modifiedAt} compact className="tabular-nums" />
				</span>
			</button>
		</li>
	);
}
