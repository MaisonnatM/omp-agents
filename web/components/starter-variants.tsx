/**
 * Prototype, throwaway: five ways the New session page could offer its starters, behind a floating switcher.
 * `#new?variant=<id>` or the switcher picks one; `&at=<ISO time>` pretends it is another time.
 */
import { ArrowRight, Bookmark, CalendarDays, ChevronLeft, ChevronRight, GitPullRequest, History, ListChecks, Plus, RefreshCw, Rocket, Search, Server, Sparkles, UserSearch, X, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Ticket } from "../../src/shared/tickets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { folderName, pastLabel } from "../labels";
import { QUICK_ACTIONS } from "../quick-actions";
import { pullRequestsStore, ticketsStore } from "../reads";
import { type Intent, type IntentId, ownOpenPullRequests, rankIntents, type StarterContext } from "../starter-intents";
import { useGitCheckout } from "../use-git-checkout";
import { useDashboardStatus } from "./dashboard-context";
import { Kbd } from "./kbd";
import { type BoardLists, PullRequestsColumn, SessionsColumn, StartersColumnBoard } from "./new-session-board";
import { Age } from "./age";

export const VARIANTS = [
	{ id: "starters-column", name: "Starters column" },
	{ id: "hero-card", name: "Hero card" },
	{ id: "composer-chips", name: "Composer chips" },
	{ id: "intent-palette", name: "Intent palette" },
	{ id: "context-cards", name: "Context cards" },
	{ id: "ghost-prompt", name: "Ghost prompt" },
] as const;
export type VariantId = (typeof VARIANTS)[number]["id"];

const VARIANT_KEY = "omp-agents.prototype.starter-variant";
const isVariant = (value: string | null): value is VariantId => VARIANTS.some(variant => variant.id === value);
const hashQuery = () => new URLSearchParams(location.hash.split("?")[1] ?? "");

function readVariant(): VariantId {
	const fromHash = hashQuery().get("variant");
	if (isVariant(fromHash)) return fromHash;
	const stored = localStorage.getItem(VARIANT_KEY);
	return isVariant(stored) ? stored : "hero-card";
}

const variantListeners = new Set<() => void>();
function subscribeVariant(listener: () => void): () => void {
	const onHash = () => {
		const fromHash = hashQuery().get("variant");
		if (isVariant(fromHash)) localStorage.setItem(VARIANT_KEY, fromHash);
		listener();
	};
	variantListeners.add(listener);
	window.addEventListener("hashchange", onHash);
	return () => {
		variantListeners.delete(listener);
		window.removeEventListener("hashchange", onHash);
	};
}

export const useStarterVariant = (): VariantId => useSyncExternalStore(subscribeVariant, readVariant);

function pickVariant(id: VariantId): void {
	localStorage.setItem(VARIANT_KEY, id);
	const [route, query = ""] = location.hash.slice(1).split("?");
	const params = new URLSearchParams(query);
	params.set("variant", id);
	history.replaceState(null, "", `#${route}?${params}`);
	for (const listener of variantListeners) listener();
}

export function VariantSwitcher({ current }: { current: VariantId }) {
	return (
		<nav aria-label="Starter variants (prototype)" className="fixed top-14 right-4 z-50 flex items-center gap-0.5 rounded-full bg-card/95 p-1 text-[12px] shadow-surface-4 backdrop-blur">
			<span className="px-2 font-medium text-muted-foreground">Prototype</span>
			{VARIANTS.map(variant => (
				<button
					key={variant.id}
					type="button"
					aria-pressed={variant.id === current}
					onClick={() => pickVariant(variant.id)}
					className={cn("h-7 rounded-full px-3 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", variant.id === current && "bg-foreground text-background hover:bg-foreground")}
				>
					{variant.name}
				</button>
			))}
		</nav>
	);
}

const ICONS: Record<IntentId, LucideIcon> = {
	"dev-server": Server,
	ship: Rocket,
	shepherd: GitPullRequest,
	week: CalendarDays,
	prune: ListChecks,
	update: RefreshCw,
	"who-changed": UserSearch,
};

/** The order the fixed layouts keep, so a starter stays where you last found it. */
const FIXED_ORDER: IntentId[] = ["dev-server", "ship", "shepherd", "week", "prune", "update", "who-changed"];
const fixed = (intents: Intent[]): Intent[] => FIXED_ORDER.flatMap(id => intents.find(intent => intent.id === id) ?? []);

const NO_TICKETS: Ticket[] = [];

function useNow(): Date {
	const at = hashQuery().get("at");
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const tick = () => setNow(new Date());
		const timer = setInterval(tick, 60_000);
		window.addEventListener("hashchange", tick);
		return () => {
			clearInterval(timer);
			window.removeEventListener("hashchange", tick);
		};
	}, []);
	return at && !Number.isNaN(Date.parse(at)) ? new Date(at) : now;
}

function useIntents(cwd: string, waiting: number): { intents: Intent[]; ctx: StarterContext } {
	const checkout = useGitCheckout(cwd);
	const tickets = ticketsStore.usePolling().read?.data.tickets ?? NO_TICKETS;
	const { pullRequestsScope } = useDashboardStatus();
	const list = pullRequestsStore.use(pullRequestsScope).read?.data ?? null;
	const now = useNow();
	const minute = Math.floor(now.getTime() / 60_000);
	return useMemo(() => {
		const ctx: StarterContext = {
			folder: folderName(cwd) ?? cwd,
			branch: checkout?.branch ?? null,
			branches: checkout?.branches.map(branch => branch.name) ?? [],
			tickets: tickets.filter(ticket => ticket.statusType !== "completed" && ticket.statusType !== "canceled"),
			mine: ownOpenPullRequests(list),
			waiting,
			now: new Date(minute * 60_000),
		};
		return { intents: rankIntents(ctx), ctx };
	}, [cwd, checkout, tickets, list, waiting, minute]);
}

interface VariantProps {
	variant: VariantId;
	lists: BoardLists;
	prefill: (prompt: string) => void;
	cwd: string;
	draft: string;
	note: string;
	heading: ReactNode;
}

export function StarterVariant({ variant, lists, prefill, cwd, draft, heading }: VariantProps) {
	const { intents, ctx } = useIntents(cwd, lists.pullRequests.length);
	switch (variant) {
		case "starters-column":
			return <StartersColumnBoard lists={lists} prefill={prefill} heading={heading} />;
		case "hero-card":
			return <HeroCard intents={intents} lists={lists} prefill={prefill} heading={heading} />;
		case "composer-chips":
			return <ComposerChips intents={intents} lists={lists} prefill={prefill} heading={heading} draft={draft} />;
		case "intent-palette":
			return <IntentPalette intents={intents} lists={lists} prefill={prefill} heading={heading} />;
		case "context-cards":
			return <ContextCards intents={intents} ctx={ctx} lists={lists} prefill={prefill} heading={heading} />;
		case "ghost-prompt":
			return <GhostPromptBoard intents={intents} lists={lists} heading={heading} />;
	}
}

interface StartersProps {
	intents: Intent[];
	lists: BoardLists;
	prefill: (prompt: string) => void;
	heading: ReactNode;
}

function Pill({ icon, children, onClick, className, title }: { icon?: ReactNode; children: ReactNode; onClick: () => void; className?: string; title?: string }) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			className={cn(
				"inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-full bg-card px-3 text-[12.5px] shadow-surface-1 outline-none transition-[background-color,scale,opacity] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
				className,
			)}
		>
			{icon}
			<span className="truncate">{children}</span>
		</button>
	);
}

/** One suggestion at a time, picked by the day, the hour, and what waits on you. */
function HeroCard({ intents, lists, prefill, heading }: StartersProps) {
	const [index, setIndex] = useState(0);
	const at = index % intents.length;
	const intent = intents[at];
	const Icon = ICONS[intent.id];
	const prompt = intent.prompt();
	const sessions = lists.sessions.slice(0, 2);
	const pullRequests = lists.pullRequests.slice(0, 2);
	return (
		<div className="relative m-auto flex w-full max-w-[640px] flex-col items-center gap-6 py-8">
			{heading}
			<section aria-label="Suggested start" className="w-full rounded-[22px] bg-card/90 p-6 shadow-surface-3 backdrop-blur">
				<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<Sparkles aria-hidden className="size-3.5 text-primary" />
					{intent.reason ?? "One of your usual starts"}
					<span className="ml-auto tabular-nums">
						{at + 1} of {intents.length}
					</span>
				</div>
				<div className="mt-4 flex items-center gap-3.5">
					<span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-primary/10 text-primary">
						<Icon aria-hidden className="size-5" />
					</span>
					<div className="min-w-0">
						<h3 className="text-[22px] leading-tight font-semibold tracking-[-0.015em]">{intent.label}</h3>
						{intent.detail && <p className="truncate text-[13px] text-muted-foreground">{intent.detail}</p>}
					</div>
				</div>
				<p className="mt-4 rounded-[12px] bg-muted/60 px-3.5 py-2.5 text-[13.5px] leading-relaxed">{prompt}</p>
				<div className="mt-5 flex items-center gap-2">
					<Button onClick={() => prefill(prompt)}>Draft it</Button>
					<Button variant="ghost" onClick={() => setIndex(at + 1)}>
						Something else <ArrowRight aria-hidden className="ms-1 size-3.5" />
					</Button>
					<div className="ml-auto flex items-center gap-1.5">
						{intents.map((other, i) => (
							<button
								key={other.id}
								type="button"
								aria-label={other.label}
								title={other.label}
								onClick={() => setIndex(i)}
								className={cn("size-2 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", i === at ? "bg-foreground" : "bg-muted-foreground/25 hover:bg-muted-foreground/50")}
							/>
						))}
					</div>
				</div>
			</section>
			{(sessions.length > 0 || pullRequests.length > 0) && (
				<div className="flex w-full flex-wrap items-center justify-center gap-1.5">
					<span className="me-1 text-[12.5px] text-muted-foreground">Or pick up</span>
					{sessions.map(session => (
						<Pill key={session.sessionId} icon={<History />} onClick={() => lists.resume(session)}>
							{pastLabel(session)}
						</Pill>
					))}
					{pullRequests.map(item => (
						<Pill key={`${item.pr.owner}/${item.pr.repo}#${item.pr.number}`} icon={<GitPullRequest />} onClick={() => lists.runPullRequest(item)} title={item.pr.title}>
							{QUICK_ACTIONS[item.action].label} #{item.pr.number}
						</Pill>
					))}
				</div>
			)}
		</div>
	);
}

const SHORT: Record<IntentId, string> = {
	"dev-server": "Dev server",
	ship: "Ship",
	shepherd: "Shepherd PRs",
	week: "Sum up week",
	prune: "Prune todos",
	update: "Update omp",
	"who-changed": "Who changed this",
};

interface SavedChip {
	id: string;
	label: string;
	prompt: string;
}

function useStoredList<T>(key: string): [T[], (next: T[]) => void] {
	const [value, setValue] = useState<T[]>(() => {
		try {
			const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
			return Array.isArray(parsed) ? (parsed as T[]) : [];
		} catch {
			return [];
		}
	});
	return [
		value,
		next => {
			localStorage.setItem(key, JSON.stringify(next));
			setValue(next);
		},
	];
}

/** Starters as chips against the composer, which light up as you type and which you add to or prune. */
function ComposerChips({ intents, lists, prefill, heading, draft }: StartersProps & { draft: string }) {
	const [saved, setSaved] = useStoredList<SavedChip>("omp-agents.prototype.saved-chips");
	const [hidden, setHidden] = useStoredList<IntentId>("omp-agents.prototype.hidden-chips");
	const words = draft
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(word => word.length >= 3 && !["the", "and", "for", "this", "that", "with", "you", "please"].includes(word));
	const typing = words.length > 0;
	const matches = (text: string) => words.some(word => text.toLowerCase().includes(word));
	const chips = [
		...fixed(intents)
			.filter(intent => !hidden.includes(intent.id))
			.map(intent => ({ key: intent.id, label: SHORT[intent.id], suffix: intent.slot?.options[0]?.label ?? null, icon: ICONS[intent.id], prompt: intent.prompt(), remove: () => setHidden([...hidden, intent.id]) })),
		...saved.map(chip => ({ key: chip.id, label: chip.label, suffix: null, icon: Bookmark, prompt: chip.prompt, remove: () => setSaved(saved.filter(other => other.id !== chip.id)) })),
	];
	const text = draft.trim();
	const canSave = text.length > 0 && !chips.some(chip => chip.prompt.trim() === text);
	return (
		<>
			<div className="relative m-auto flex w-full flex-col items-center gap-7 py-8">
				{heading}
				<section aria-label="Pick up work" className="mx-auto grid w-full max-w-[760px] grid-cols-1 rounded-[18px] bg-card/80 shadow-surface-3 backdrop-blur md:grid-cols-2 [&>*+*]:border-t [&>*+*]:border-border md:[&>*+*]:border-t-0 md:[&>*+*]:border-s">
					<SessionsColumn lists={lists} />
					<PullRequestsColumn lists={lists} />
				</section>
			</div>
			<div className="sticky bottom-0 mx-auto w-full max-w-conversation px-3 pt-3 pb-2">
				<div role="list" aria-label="Starters" className="flex flex-wrap gap-1.5">
					{chips.map(chip => {
						const Icon = chip.icon;
						const lit = typing && matches(`${chip.label} ${chip.suffix ?? ""} ${chip.prompt}`);
						return (
							<span key={chip.key} role="listitem" className={cn("group/chip relative inline-flex transition-opacity duration-150", typing && !lit && "opacity-35")}>
								<Pill icon={<Icon />} onClick={() => prefill(chip.prompt)} title={chip.prompt} className={cn("pe-7", lit && "ring-1 ring-primary/60")}>
									{chip.label}
									{chip.suffix && <span className="ms-1 text-muted-foreground">{chip.suffix}</span>}
								</Pill>
								<button
									type="button"
									aria-label={`Remove ${chip.label}`}
									onClick={chip.remove}
									className="absolute end-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100"
								>
									<X aria-hidden className="size-3" />
								</button>
							</span>
						);
					})}
					{canSave && (
						<Pill icon={<Plus />} onClick={() => setSaved([...saved, { id: crypto.randomUUID(), label: text.split(/\s+/).slice(0, 4).join(" "), prompt: text }])} className="border border-dashed border-border bg-transparent shadow-none">
							Save as a starter
						</Pill>
					)}
					{hidden.length > 0 && (
						<button type="button" onClick={() => setHidden([])} className="h-7 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground">
							Show {hidden.length} hidden
						</button>
					)}
				</div>
			</div>
		</>
	);
}

interface PaletteItem {
	key: string;
	group: "Start" | "Resume" | "Your move";
	icon: ReactNode;
	label: string;
	detail: ReactNode;
	search: string;
	slot: Intent["slot"];
	/** What Enter does, given the slot's chosen value. */
	run: (value: string | undefined) => void;
	/** What Enter drafts, for a starter. */
	preview: ((value: string | undefined) => string) | null;
	verb: string;
}

/** A keyboard-first list of every way to start: starters with slots filled from context, then resumes and pull requests. */
function IntentPalette({ intents, lists, prefill, heading }: StartersProps) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const [choices, setChoices] = useState<Record<string, number>>({});
	const listRef = useRef<HTMLUListElement>(null);
	const items: PaletteItem[] = [
		...intents.map(
			(intent): PaletteItem => {
				const Icon = ICONS[intent.id];
				return {
					key: intent.id,
					group: "Start",
					icon: <Icon aria-hidden className="size-4 text-muted-foreground" />,
					label: intent.label,
					detail: intent.detail,
					search: `${intent.label} ${intent.detail ?? ""} ${intent.slot?.options.map(option => `${option.label} ${option.hint ?? ""}`).join(" ") ?? ""}`,
					slot: intent.slot,
					run: value => prefill(intent.prompt(value)),
					preview: intent.prompt,
					verb: "Draft",
				};
			},
		),
		...lists.sessions.slice(0, 3).map(
			(session): PaletteItem => ({
				key: session.sessionId,
				group: "Resume",
				icon: <History aria-hidden className="size-4 text-muted-foreground" />,
				label: pastLabel(session),
				detail: (
					<>
						{session.interrupted ? "Interrupted" : "Ended"} · <Age at={session.modifiedAt} compact className="tabular-nums" />
					</>
				),
				search: pastLabel(session),
				slot: null,
				run: () => lists.resume(session),
				preview: null,
				verb: "Resume",
			}),
		),
		...lists.pullRequests.slice(0, 3).map(
			(item): PaletteItem => ({
				key: `${item.pr.owner}/${item.pr.repo}#${item.pr.number}`,
				group: "Your move",
				icon: <GitPullRequest aria-hidden className="size-4 text-muted-foreground" />,
				label: item.pr.title,
				detail: `${item.pr.repo} #${item.pr.number}`,
				search: `${item.pr.title} ${item.pr.repo} ${item.pr.number}`,
				slot: null,
				run: () => lists.runPullRequest(item),
				preview: null,
				verb: QUICK_ACTIONS[item.action].label,
			}),
		),
	];
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const shown = items.filter(item => words.every(word => item.search.toLowerCase().includes(word)));
	const current = Math.min(selected, Math.max(0, shown.length - 1));
	const valueOf = (item: PaletteItem) => item.slot?.options[(choices[item.key] ?? 0) % item.slot.options.length]?.value;
	const cycle = (item: PaletteItem, step: number) => {
		if (!item.slot) return;
		const length = item.slot.options.length;
		setChoices(previous => ({ ...previous, [item.key]: ((previous[item.key] ?? 0) + step + length) % length }));
	};
	useEffect(() => {
		listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
	}, [current]);
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const item = shown[current];
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setSelected((current + step + shown.length) % Math.max(1, shown.length));
		} else if (event.key === "Tab" && item?.slot) {
			event.preventDefault();
			cycle(item, event.shiftKey ? -1 : 1);
		} else if (event.key === "Enter" && item) {
			event.preventDefault();
			item.run(valueOf(item));
		}
	};
	let lastGroup: string | null = null;
	return (
		<div className="relative m-auto flex w-full max-w-[680px] flex-col items-center gap-7 py-8">
			{heading}
			<section aria-label="Start from an intent" className="w-full overflow-hidden rounded-[18px] bg-card/90 shadow-surface-3 backdrop-blur">
				<label className="flex items-center gap-2.5 border-b border-border px-4">
					<Search aria-hidden className="size-4 text-muted-foreground" />
					<input
						autoFocus
						value={query}
						onChange={event => {
							setQuery(event.target.value);
							setSelected(0);
						}}
						onKeyDown={onKeyDown}
						placeholder="What do you want to do?"
						className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
					/>
				</label>
				<ul ref={listRef} role="listbox" className="max-h-[420px] overflow-y-auto p-1.5">
					{shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing matches. Type it in the message instead.</li>}
					{shown.map((item, index) => {
						const header = item.group !== lastGroup ? item.group : null;
						lastGroup = item.group;
						const active = index === current;
						const value = valueOf(item);
						const option = item.slot?.options.find(candidate => candidate.value === value);
						return (
							<li key={item.key} data-index={index} role="option" aria-selected={active}>
								{header && <p className="px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{header}</p>}
								<div
									onMouseMove={() => setSelected(index)}
									onClick={() => item.run(value)}
									className={cn("grid cursor-default grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[10px] px-3 py-2", active && "bg-hover")}
								>
									{item.icon}
									<div className="flex min-w-0 items-center gap-2">
										<span className="truncate text-[13.5px] font-medium">{item.label}</span>
										{item.slot && option ? (
											<span className="inline-flex shrink-0 items-center rounded-full border border-border bg-background text-[12px]" onClick={event => event.stopPropagation()}>
												<button type="button" aria-label={`Previous ${item.slot.name}`} onClick={() => cycle(item, -1)} className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground">
													<ChevronLeft aria-hidden className="size-3" />
												</button>
												<span className="max-w-[160px] truncate font-medium tabular-nums">{option.label}</span>
												<button type="button" aria-label={`Next ${item.slot.name}`} onClick={() => cycle(item, 1)} className="grid h-6 w-5 place-items-center text-muted-foreground hover:text-foreground">
													<ChevronRight aria-hidden className="size-3" />
												</button>
											</span>
										) : (
											item.detail && <span className="truncate text-[12px] text-muted-foreground">{item.detail}</span>
										)}
									</div>
									<span className={cn("text-xs text-muted-foreground", !active && "opacity-0")}>{item.verb} ↵</span>
									{active && item.preview && <span className="col-start-2 col-end-4 mt-0.5 truncate text-[12px] text-muted-foreground">{option?.hint ? `${item.preview(value)}  ·  ${option.hint}` : item.preview(value)}</span>}
								</div>
							</li>
						);
					})}
				</ul>
				<footer className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
					<span className="inline-flex items-center gap-1">
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd> choose
					</span>
					<span className="inline-flex items-center gap-1">
						<Kbd>Tab</Kbd> change the branch, issue, or week
					</span>
					<span className="ml-auto inline-flex items-center gap-1">
						<Kbd>↵</Kbd> draft or run
					</span>
				</footer>
			</section>
		</div>
	);
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** What a card says in large type, and the line under it. */
function cardFace(intent: Intent, ctx: StarterContext): { headline: string; sub: string } {
	switch (intent.id) {
		case "dev-server":
			return { headline: ctx.branch ?? ctx.folder, sub: ctx.branch && ctx.branch !== ctx.folder ? `in ${ctx.folder}, then the URL` : "Start it, then get the URL" };
		case "ship": {
			const [first] = intent.slot?.options ?? [];
			return first ? { headline: first.label, sub: first.hint ?? "" } : { headline: "No issue", sub: "Paste a Linear issue after /ship" };
		}
		case "shepherd":
			return { headline: `${ctx.waiting} wait on you`, sub: `${ctx.mine.length} of yours open` };
		case "week": {
			const monday = new Date(ctx.now);
			monday.setDate(ctx.now.getDate() - ((ctx.now.getDay() + 6) % 7) - (intent.label.includes("last") ? 7 : 0));
			const end = new Date(monday);
			end.setDate(monday.getDate() + 4);
			const last = intent.label.includes("last");
			return { headline: `${SHORT_DATE.format(monday)} – ${last ? SHORT_DATE.format(end) : "today"}`, sub: last ? "Last week's merges" : "This week's merges so far" };
		}
		case "prune":
			return { headline: `${ctx.tickets.length} assigned`, sub: intent.detail?.split(" · ")[1] ?? "Close what went stale" };
		case "update":
			return { headline: "omp + pstack", sub: "Check both are current" };
		case "who-changed":
			return { headline: ctx.folder, sub: "Who left the uncommitted changes" };
	}
}

/** The board as live cards: every starter shows what it would act on now, with its likeliest choices one click away. */
function ContextCards({ intents, ctx, lists, prefill, heading }: StartersProps & { ctx: StarterContext }) {
	const top = intents[0]?.id;
	const [session] = lists.sessions;
	return (
		<div className="relative m-auto flex w-full flex-col items-center gap-7 py-8">
			{heading}
			<section aria-label="Starters" className="mx-auto grid w-full max-w-[1040px] grid-cols-2 gap-3 md:grid-cols-4">
				{fixed(intents).map(intent => {
					const Icon = ICONS[intent.id];
					const face = cardFace(intent, ctx);
					const suggested = intent.id === top;
					return (
						<div key={intent.id} className={cn("group/card relative flex min-h-[156px] flex-col rounded-[16px] bg-card/90 p-4 shadow-surface-2 backdrop-blur transition-shadow duration-150 hover:shadow-surface-3", suggested && "ring-1 ring-primary/50")}>
							<button type="button" aria-label={`Draft: ${intent.label}`} title={intent.prompt()} onClick={() => prefill(intent.prompt())} className="absolute inset-0 rounded-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
							<div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
								<Icon aria-hidden className="size-3.5" />
								<span className="truncate">{intent.label}</span>
								{suggested && <span className="ms-auto shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Now</span>}
							</div>
							<p className="mt-2.5 truncate text-[19px] leading-tight font-semibold tracking-[-0.01em] tabular-nums">{face.headline}</p>
							<p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{face.sub}</p>
							{intent.slot && intent.slot.options.length > 1 && (
								<div className="pointer-events-none relative mt-auto flex flex-wrap gap-1 pt-3">
									{intent.slot.options.slice(1, 4).map(option => (
										<button
											key={option.value}
											type="button"
											title={option.hint ?? intent.prompt(option.value)}
											onClick={() => prefill(intent.prompt(option.value))}
											className="pointer-events-auto h-6 max-w-[140px] truncate rounded-full bg-muted/70 px-2 text-[11.5px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
										>
											{option.label}
										</button>
									))}
								</div>
							)}
						</div>
					);
				})}
				<div className="relative flex min-h-[156px] flex-col rounded-[16px] border border-dashed border-border p-4">
					<div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
						<History aria-hidden className="size-3.5" />
						Pick up where you left off
					</div>
					{session ? (
						<>
							<p className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-semibold">{pastLabel(session)}</p>
							<p className="mt-0.5 text-[12px] text-muted-foreground">
								{session.interrupted ? "Interrupted" : "Ended"} · <Age at={session.modifiedAt} compact className="tabular-nums" />
							</p>
							<div className="mt-auto flex items-center gap-2 pt-3">
								<Button size="xs" variant="secondary" disabled={lists.resuming !== null} onClick={() => lists.resume(session)}>
									{lists.resuming === session.sessionId ? "Resuming…" : "Resume"}
								</Button>
								{lists.sessions.length > 1 && <span className="text-[11.5px] text-muted-foreground">+{lists.sessions.length - 1} more in the sidebar</span>}
							</div>
						</>
					) : (
						<p className="mt-2.5 text-[13px] text-muted-foreground">No sessions to resume.</p>
					)}
				</div>
			</section>
		</div>
	);
}

/** The ghost prompt the composer shows while empty: the board publishes it, the composer reads it. */
export interface Ghost {
	text: string;
	label: string;
	reason: string | null;
	position: string;
	step: (delta: number) => void;
}

let ghost: Ghost | null = null;
const ghostListeners = new Set<() => void>();
function publishGhost(next: Ghost | null): void {
	ghost = next;
	for (const listener of ghostListeners) listener();
}
export const useGhost = (): Ghost | null =>
	useSyncExternalStore(
		listener => {
			ghostListeners.add(listener);
			return () => ghostListeners.delete(listener);
		},
		() => ghost,
	);

/** No visible starters: the likeliest one waits as the composer's placeholder, Tab takes it, arrows swap it. */
function GhostPromptBoard({ intents, lists, heading }: Omit<StartersProps, "prefill">) {
	const [index, setIndex] = useState(0);
	const at = index % intents.length;
	const intent = intents[at];
	const text = intent.prompt();
	useEffect(() => {
		publishGhost({ text, label: intent.label, reason: intent.reason, position: `${at + 1}/${intents.length}`, step: delta => setIndex(previous => (previous + delta + intents.length) % intents.length) });
	}, [text, intent, at, intents.length]);
	useEffect(() => () => publishGhost(null), []);
	return (
		<div className="relative m-auto flex w-full flex-col items-center gap-7 py-8">
			{heading}
			<section aria-label="Pick up work" className="mx-auto grid w-full max-w-[760px] grid-cols-1 rounded-[18px] bg-card/80 shadow-surface-3 backdrop-blur md:grid-cols-2 [&>*+*]:border-t [&>*+*]:border-border md:[&>*+*]:border-t-0 md:[&>*+*]:border-s">
				<SessionsColumn lists={lists} />
				<PullRequestsColumn lists={lists} />
			</section>
		</div>
	);
}
