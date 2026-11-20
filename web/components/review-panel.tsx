/** The **Review** tab: each screen change a session's reply lists, its before and after screenshots under a wipe line, what it changed, and, for a live session, a quick edit for its composer. */
import { IconChevronDownSmall, IconCrossMedium } from "central-icons";
import { type KeyboardEvent, type MouseEvent, useId, useRef, useState } from "react";
import type { LiveView } from "../../src/shared/sessions";
import { mediaUrl } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { mediaSrc } from "../api";
import { type BeforeAfter, changeKey, type Draft, descriptionOf, EMPTY_DRAFT, type Pin, revertPrompt, tweakPrompt } from "../before-after";
import { appendToComposer, liveDraftKey } from "../composer-drafts";
import { FIELD, TEXT_AREA } from "./form-field";
import { toasts } from "./toaster";

/** Each change's draft while the page is open, by session and change, so switching tabs or changes keeps what was typed. */
const drafts = new Map<string, Draft>();

let nextPinId = 0;

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

const STEP = 5;

type Spot = { x: number; y: number };

function useDraft(key: string): [Draft, (update: (draft: Draft) => Draft) => void] {
	const [draft, setDraft] = useState<Draft>(() => drafts.get(key) ?? EMPTY_DRAFT);
	const update = (change: (draft: Draft) => Draft) => {
		const next = change(drafts.get(key) ?? draft);
		drafts.set(key, next);
		setDraft(next);
	};
	return [draft, update];
}

/** The after screenshot with the before one over its left part, up to a line you drag; with `onPin`, a click right of the line or **Add pin** pins a spot. */
function Wipe({ change, pins, onPin }: { change: BeforeAfter; pins: readonly Pin[]; onPin: ((spot: Spot) => void) | null }) {
	const [split, setSplit] = useState(50);
	const [missing, setMissing] = useState<{ before: boolean; after: boolean }>({ before: false, after: false });
	const frame = useRef<HTMLDivElement>(null);
	const spotAt = (event: MouseEvent): Spot => {
		const box = frame.current!.getBoundingClientRect();
		return { x: clamp(((event.clientX - box.left) / box.width) * 100), y: clamp(((event.clientY - box.top) / box.height) * 100) };
	};
	const onKeyDown = (event: KeyboardEvent) => {
		const next = { ArrowLeft: split - STEP, ArrowRight: split + STEP, Home: 0, End: 100 }[event.key];
		if (next === undefined) return;
		event.preventDefault();
		setSplit(clamp(next));
	};
	if (missing.before || missing.after)
		return (
			<div className="flex flex-col gap-1 text-xs text-muted-foreground">
				{missing.before && <p>Before screenshot not found: {change.before}</p>}
				{missing.after && <p>After screenshot not found: {change.after}</p>}
			</div>
		);
	return (
		<div className="flex flex-col gap-1.5">
			<div
				ref={frame}
				className={`relative touch-none overflow-hidden rounded-lg border border-border bg-muted select-none ${onPin ? "cursor-crosshair" : ""}`}
				onClick={event => {
					const spot = spotAt(event);
					if (onPin && spot.x > split) onPin(spot);
				}}
			>
				<img
					src={mediaSrc(mediaUrl(change.after))}
					alt={`After: ${change.title}`}
					draggable={false}
					onError={() => setMissing(prev => ({ ...prev, after: true }))}
					className="block w-full"
				/>
				<img
					src={mediaSrc(mediaUrl(change.before))}
					alt={`Before: ${change.title}`}
					draggable={false}
					onError={() => setMissing(prev => ({ ...prev, before: true }))}
					className="absolute inset-x-0 top-0 w-full"
					style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
				/>
				<span className="pointer-events-none absolute top-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-2xs text-white">Before</span>
				<span className="pointer-events-none absolute top-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-2xs text-white">After</span>
				{pins.map((pin, at) => (
					<span
						key={pin.id}
						className="pointer-events-none absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground ring-2 ring-background"
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
					onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
					onPointerMove={event => event.currentTarget.hasPointerCapture(event.pointerId) && setSplit(spotAt(event).x)}
					onClick={event => event.stopPropagation()}
					className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
					style={{ left: `${split}%` }}
				>
					<span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary ring-1 ring-background" />
					<span className="absolute top-1/2 left-1/2 h-6 w-3 -translate-1/2 rounded-full bg-primary shadow ring-1 ring-background" />
				</div>
			</div>
			<div className="flex items-start justify-between gap-2">
				<p className="text-xs text-muted-foreground">{onPin ? "Drag the line to compare. Click the after side to pin a spot." : "Drag the line to compare."}</p>
				{onPin && (
					<Button variant="ghost" size="xs" className="shrink-0" onClick={() => onPin({ x: (split + 100) / 2, y: 50 })}>
						Add pin
					</Button>
				)}
			</div>
		</div>
	);
}

/** A live session's quick edit on one change: its editable description, the pin notes, the request, and the buttons that send them to the composer. */
function ChangeRequest({ change, draft, update, live }: { change: BeforeAfter; draft: Draft; update: (update: (draft: Draft) => Draft) => void; live: LiveView }) {
	const id = useId();
	const prompt = tweakPrompt(change, draft);
	const toComposer = (text: string) => {
		appendToComposer(liveDraftKey(live), text);
		toasts.add({ title: "Added to the composer" });
		update(prev => ({ ...prev, pins: [], ask: "" }));
	};
	return (
		<>
			<section className="flex flex-col gap-1.5">
				<label htmlFor={`${id}-description`} className="text-xs font-medium text-muted-foreground">
					Description
				</label>
				<textarea
					id={`${id}-description`}
					rows={3}
					value={descriptionOf(change, draft)}
					placeholder="What this change does"
					onChange={event => {
						const description = event.target.value;
						update(prev => ({ ...prev, description }));
					}}
					className={`${TEXT_AREA} resize-y`}
				/>
			</section>
			<section className="flex flex-col gap-1.5">
				<label htmlFor={`${id}-ask`} className="text-xs font-medium text-muted-foreground">
					Quick edit
				</label>
				{draft.pins.map((pin, at) => (
					<div key={pin.id} className="flex items-center gap-1.5">
						<span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">{at + 1}</span>
						<input
							aria-label={`What should change at pin ${at + 1}`}
							value={pin.note}
							placeholder="What should change here?"
							autoFocus={at === draft.pins.length - 1 && pin.note === ""}
							onChange={event => {
								const note = event.target.value;
								update(prev => ({ ...prev, pins: prev.pins.map(each => (each.id === pin.id ? { ...each, note } : each)) }));
							}}
							className={`${FIELD} min-w-0 flex-1`}
						/>
						<Button
							variant="ghost"
							size="icon-xs"
							title="Remove pin"
							aria-label={`Remove pin ${at + 1}`}
							onClick={() => update(prev => ({ ...prev, pins: prev.pins.filter(each => each.id !== pin.id) }))}
						>
							<IconCrossMedium />
						</Button>
					</div>
				))}
				<textarea
					id={`${id}-ask`}
					rows={3}
					value={draft.ask}
					placeholder="What should change?"
					onChange={event => {
						const ask = event.target.value;
						update(prev => ({ ...prev, ask }));
					}}
					onKeyDown={event => {
						if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
						event.preventDefault();
						if (prompt !== null) toComposer(prompt);
					}}
					className={`${TEXT_AREA} resize-y`}
				/>
				<div className="flex flex-wrap gap-1.5">
					<Button {...activityControl("review.tweak")} size="compact" disabled={prompt === null} onClick={() => prompt !== null && toComposer(prompt)}>
						Add to composer
					</Button>
					<Button {...activityControl("review.revert")} variant="outline" size="compact" onClick={() => toComposer(revertPrompt(change))}>
						Ask to revert
					</Button>
				</div>
			</section>
		</>
	);
}

/** One change: the wipe and its description, with the quick edit when the session is live. */
function ChangeReview({ draftKey, change, live }: { draftKey: string; change: BeforeAfter; live: LiveView | null }) {
	const [draft, update] = useDraft(draftKey);
	return (
		<div className="flex flex-col gap-4 p-3">
			<Wipe change={change} pins={draft.pins} onPin={live && (spot => update(prev => ({ ...prev, pins: [...prev.pins, { ...spot, id: nextPinId++, note: "" }] })))} />
			{live ? (
				<ChangeRequest change={change} draft={draft} update={update} live={live} />
			) : (
				<section className="flex flex-col gap-1.5">
					{change.description && <p className="text-sm">{change.description}</p>}
					<p className="text-xs text-muted-foreground">Resume the session to ask for changes.</p>
				</section>
			)}
		</div>
	);
}

/** The changes of the session's latest `before-after` list, one at a time, picked from the toolbar once there are two. */
export function ReviewPanel({ scope, changes, live }: { scope: string; changes: readonly BeforeAfter[]; live: LiveView | null }) {
	const [picked, setPicked] = useState<string | null>(null);
	const change = changes.find(each => changeKey(each) === picked) ?? changes[0]!;
	const key = changeKey(change);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex min-h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
				{changes.length > 1 ? (
					<h3 className="flex min-w-0">
						<DropdownMenu>
							<DropdownMenuTrigger
								{...activityControl("review.change")}
								render={<Button variant="ghost" size="compact" trailingIcon={IconChevronDownSmall} aria-label={`${change.title}, one of ${changes.length} changes`} className="min-w-0 font-medium text-foreground" />}
							>
								{change.title}
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="max-w-96">
								<MenuRadioGroup aria-label="Changes" value={key} onValueChange={(value: string) => setPicked(value)}>
									{changes.map(each => (
										<MenuRadioItem key={changeKey(each)} value={changeKey(each)} closeOnClick>
											<span className="block min-w-0 flex-1 truncate">{each.title}</span>
										</MenuRadioItem>
									))}
								</MenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</h3>
				) : (
					<h3 title={change.title} className="min-w-0 truncate px-1.5 text-sm font-medium">
						{change.title}
					</h3>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<ChangeReview key={`${scope}\n${key}`} draftKey={`${scope}\n${key}`} change={change} live={live} />
			</div>
		</div>
	);
}
