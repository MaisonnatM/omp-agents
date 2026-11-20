/** The **Review** tab: each screen change a session's reply lists, its before and after screenshots under a wipe line, what it changed, and a quick edit for the session's composer. */
import { IconChevronDownSmall, IconCrossMedium } from "central-icons";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { LiveView } from "../../src/shared/sessions";
import { mediaUrl } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { mediaSrc } from "../api";
import { type BeforeAfter, type Pin, revertPrompt, tweakPrompt } from "../before-after";
import { appendToComposer, liveDraftKey } from "../composer-drafts";
import { TEXT_AREA } from "./form-field";
import { toasts } from "./toaster";

/** What the user wrote about one change: its description as edited, the spots pinned on it, and the request typed. */
interface Draft {
	description: string;
	pins: Pin[];
	ask: string;
}

/** Each change's draft while the page is open, by session and title, so switching tabs or changes keeps what was typed. */
const drafts = new Map<string, Draft>();

const draftKey = (scope: string, change: BeforeAfter): string => `${scope}\n${change.title}`;

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

const STEP = 5;

function useDraft(key: string, change: BeforeAfter): [Draft, (update: (draft: Draft) => Draft) => void] {
	const [draft, setDraft] = useState<Draft>(() => drafts.get(key) ?? { description: change.description, pins: [], ask: "" });
	const update = (change: (draft: Draft) => Draft) =>
		setDraft(prev => {
			const next = change(prev);
			drafts.set(key, next);
			return next;
		});
	return [draft, update];
}

/** The after screenshot with the before one over its left part, up to a line you drag; a click right of the line pins a spot. */
function Wipe({ change, pins, onPin }: { change: BeforeAfter; pins: readonly Pin[]; onPin: (pin: Pin) => void }) {
	const [split, setSplit] = useState(50);
	const frame = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const spotAt = (event: PointerEvent): { x: number; y: number } => {
		const box = frame.current!.getBoundingClientRect();
		return { x: clamp(((event.clientX - box.left) / box.width) * 100), y: clamp(((event.clientY - box.top) / box.height) * 100) };
	};
	const onKeyDown = (event: KeyboardEvent) => {
		const next = { ArrowLeft: split - STEP, ArrowRight: split + STEP, Home: 0, End: 100 }[event.key];
		if (next === undefined) return;
		event.preventDefault();
		setSplit(clamp(next));
	};
	return (
		<div
			ref={frame}
			className="relative cursor-crosshair touch-none overflow-hidden rounded-lg border border-border bg-muted select-none"
			onPointerMove={event => dragging.current && setSplit(spotAt(event).x)}
			onPointerUp={event => {
				if (dragging.current) {
					dragging.current = false;
					return;
				}
				const spot = spotAt(event);
				if (spot.x > split) onPin({ ...spot, note: "" });
			}}
		>
			<img src={mediaSrc(mediaUrl(change.after))} alt={`After: ${change.title}`} draggable={false} className="block w-full" />
			<img
				src={mediaSrc(mediaUrl(change.before))}
				alt={`Before: ${change.title}`}
				draggable={false}
				className="absolute inset-x-0 top-0 w-full"
				style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
			/>
			<span className="pointer-events-none absolute top-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-2xs text-white">Before</span>
			<span className="pointer-events-none absolute top-1.5 right-1.5 rounded-full bg-black/65 px-2 py-0.5 text-2xs text-white">After</span>
			{pins.map((pin, at) => (
				<span
					key={`${pin.x}:${pin.y}`}
					className="pointer-events-none absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-warning text-2xs font-semibold text-black ring-2 ring-background"
					style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
				>
					{at + 1}
				</span>
			))}
			<div
				role="slider"
				tabIndex={0}
				aria-label="Before and after"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(split)}
				aria-valuetext={`${Math.round(split)}% before`}
				onKeyDown={onKeyDown}
				onPointerDown={event => {
					event.stopPropagation();
					dragging.current = true;
					frame.current!.setPointerCapture(event.pointerId);
				}}
				className="absolute inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
				style={{ left: `${split}%` }}
			>
				<span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary" />
				<span className="absolute top-1/2 left-1/2 h-6 w-3 -translate-1/2 rounded-full bg-primary shadow" />
			</div>
		</div>
	);
}

/** One change: the wipe, its description, and the quick edit, which only a live session takes. */
function ChangeReview({ scope, change, live }: { scope: string; change: BeforeAfter; live: LiveView | null }) {
	const [draft, update] = useDraft(draftKey(scope, change), change);
	const ready = draft.ask.trim() !== "" || draft.pins.some(pin => pin.note.trim() !== "");
	const toComposer = (prompt: string) => {
		if (live === null) return;
		appendToComposer(liveDraftKey(live), prompt);
		toasts.add({ title: "Added to the composer" });
		update(prev => ({ ...prev, pins: [], ask: "" }));
	};
	const addTweak = () => ready && toComposer(tweakPrompt(change, draft.description, draft.pins, draft.ask));
	return (
		<div className="flex flex-col gap-4 p-3">
			<div className="flex flex-col gap-1.5">
				<Wipe change={change} pins={draft.pins} onPin={pin => update(prev => ({ ...prev, pins: [...prev.pins, pin] }))} />
				<p className="text-xs text-muted-foreground">Drag the line to compare. Click the after side to pin a spot.</p>
			</div>
			<section className="flex flex-col gap-1.5">
				<label htmlFor="review-description" className="text-xs font-medium text-muted-foreground">
					Description
				</label>
				<textarea
					id="review-description"
					rows={3}
					value={draft.description}
					placeholder="What this change does"
					onChange={event => {
						const description = event.target.value;
						update(prev => ({ ...prev, description }));
					}}
					className={TEXT_AREA}
				/>
			</section>
			<section className="flex flex-col gap-1.5">
				<label htmlFor="review-ask" className="text-xs font-medium text-muted-foreground">
					Quick edit
				</label>
				{draft.pins.map((pin, at) => (
					<div key={`${pin.x}:${pin.y}`} className="flex items-center gap-1.5">
						<span className="grid size-5 shrink-0 place-items-center rounded-full bg-warning text-2xs font-semibold text-black">{at + 1}</span>
						<input
							aria-label={`What should change at pin ${at + 1}`}
							value={pin.note}
							placeholder="What should change here?"
							autoFocus={at === draft.pins.length - 1 && pin.note === ""}
							onChange={event => {
								const note = event.target.value;
								update(prev => ({ ...prev, pins: prev.pins.map((each, index) => (index === at ? { ...each, note } : each)) }));
							}}
							className={TEXT_AREA}
						/>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Remove pin ${at + 1}`}
							onClick={() => update(prev => ({ ...prev, pins: prev.pins.filter((_, index) => index !== at) }))}
						>
							<IconCrossMedium />
						</Button>
					</div>
				))}
				<textarea
					id="review-ask"
					rows={3}
					value={draft.ask}
					placeholder="What should change?"
					onChange={event => {
						const ask = event.target.value;
						update(prev => ({ ...prev, ask }));
					}}
					onKeyDown={event => {
						if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || live === null) return;
						event.preventDefault();
						addTweak();
					}}
					className={TEXT_AREA}
				/>
				{live === null ? (
					<p className="text-xs text-muted-foreground">Resume the session to ask for changes.</p>
				) : (
					<div className="flex flex-wrap gap-1.5">
						<Button {...activityControl("review.tweak")} size="compact" disabled={!ready} onClick={addTweak}>
							Add to composer
						</Button>
						<Button {...activityControl("review.revert")} variant="outline" size="compact" onClick={() => toComposer(revertPrompt(change))}>
							Ask to revert
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}

/** The changes of the session's latest `before-after` list, one at a time, picked from the toolbar once there are two. */
export function ReviewPanel({ scope, changes, live }: { scope: string; changes: readonly BeforeAfter[]; live: LiveView | null }) {
	const [picked, setPicked] = useState<string | null>(null);
	const change = changes.find(each => each.title === picked) ?? changes[0]!;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex min-h-9 shrink-0 items-center border-b border-border px-1.5">
				{changes.length > 1 ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							{...activityControl("review.change")}
							render={<Button variant="ghost" size="compact" trailingIcon={IconChevronDownSmall} aria-label={`${change.title}, one of ${changes.length} changes`} className="min-w-0 font-medium text-foreground" />}
						>
							{change.title}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="max-w-96">
							<MenuRadioGroup aria-label="Changes" value={change.title} onValueChange={(title: string) => setPicked(title)}>
								{changes.map(each => (
									<MenuRadioItem key={each.title} value={each.title} closeOnClick>
										<span className="block min-w-0 flex-1 truncate">{each.title}</span>
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				) : (
					<h3 className="truncate px-1.5 text-[13px] font-medium">{change.title}</h3>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<ChangeReview key={draftKey(scope, change)} scope={scope} change={change} live={live} />
			</div>
		</div>
	);
}
