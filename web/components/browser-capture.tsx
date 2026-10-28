/**
 * The Browser's picking, as T3 Code has it: `usePicking`, a Browser's picking session and **Screenshot**, with the image
 * files they attach to the composer, and `Picking`, the Select, Region, Draw, and Erase switch over the page and the
 * layer where Region boxes and Draw lines mark the page, with the card that attaches them and the selected elements.
 */
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ControlId } from "../../src/shared/activity";
import type { PreviewElementBox } from "../../src/shared/desktop-bridge";
import { activityControl } from "../activity";
import { annotationText, type Area, boundsOf, cardPlace, dragArea, elementAt, type Mark, markAt, type Point, STROKE_WIDTH, strokeArea, unionArea } from "../browser-model";
import { appendToComposer, attachToComposer } from "../composer-drafts";
import { annotationReference } from "../prompt-tokens";
import { type ShortcutId, shortcutBindings, shortcutKeys, useShortcuts } from "../shortcuts";
import type { Webview } from "../use-webview";
import { toasts } from "./toaster";

/** Select picks elements in the app; Region and Draw mark the page; Erase removes a mark or a selected element. */
export type PickMode = "select" | "region" | "draw" | "erase";

const MODES: { mode: PickMode; label: string; hint: string; control: ControlId; shortcut: ShortcutId }[] = [
	{ mode: "select", label: "Select", hint: "Select an element", control: "browser.pick.select", shortcut: "browserPickSelect" },
	{ mode: "region", label: "Region", hint: "Draw a box around an area", control: "browser.pick.region", shortcut: "browserPickRegion" },
	{ mode: "draw", label: "Draw", hint: "Draw freehand", control: "browser.pick.draw", shortcut: "browserPickDraw" },
	{ mode: "erase", label: "Erase", hint: "Remove a box, a line, or an element", control: "browser.pick.erase", shortcut: "browserPickErase" },
];

/** The space kept around the marks in the attached image, in the page's CSS pixels. */
const IMAGE_MARGIN = 8;

const fileName = (what: string): string => `Browser ${what} ${new Date().toLocaleTimeString()}.png`;

/** `png`, all the page shows, as an image file to attach. */
const screenshotFile = (png: Uint8Array): File => new File([new Uint8Array(png)], fileName("screenshot"), { type: "image/png" });

/**
 * `png`, all the page shows at the screen's density, with `marks` drawn on it in `color`, cut to the marks, the
 * `elements`, whose outlines the app drew itself, and a margin around them, as an image file to attach. `pageWidth` is
 * the page's CSS width, which gives the density.
 */
async function annotationFile(png: Uint8Array, marks: readonly Mark[], elements: readonly Area[], pageWidth: number, color: string): Promise<File> {
	const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
	const scale = bitmap.width / pageWidth;
	const bounds = unionArea(
		[...marks.map(mark => mark.area), ...elements],
		IMAGE_MARGIN,
		pageWidth,
		bitmap.height / scale,
	) ?? { x: 0, y: 0, width: pageWidth, height: bitmap.height / scale };
	const canvas = new OffscreenCanvas(Math.max(1, Math.round(bounds.width * scale)), Math.max(1, Math.round(bounds.height * scale)));
	const context = canvas.getContext("2d");
	if (context) {
		context.scale(scale, scale);
		context.translate(-bounds.x, -bounds.y);
		context.drawImage(bitmap, 0, 0, pageWidth, bitmap.height / scale);
		context.strokeStyle = color;
		context.fillStyle = color;
		context.lineCap = "round";
		context.lineJoin = "round";
		for (const mark of marks) {
			context.beginPath();
			if (mark.kind === "region") {
				context.rect(mark.area.x, mark.area.y, mark.area.width, mark.area.height);
				context.globalAlpha = 0.06;
				context.fill();
				context.globalAlpha = 1;
				context.lineWidth = 2;
			} else {
				mark.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
				context.lineWidth = STROKE_WIDTH;
			}
			context.stroke();
		}
	}
	bitmap.close();
	return new File([await canvas.convertToBlob({ type: "image/png" })], fileName("annotation"), { type: "image/png" });
}

/** What one **Attach** of {@link Picking} hands over: the marks, the comment typed beside them, and the page's CSS width. */
export interface Marking {
	marks: Mark[];
	comment: string;
	pageWidth: number;
}

/** A Browser's picking session, which {@link usePicking} keeps. */
export interface PickingSession {
	/** The pick mode, or `null` while not picking. */
	mode: PickMode | null;
	/** The dashboard's accent, read as picking starts, which the outlines in the app, the marks, and their picture take. */
	color: string;
	/** Where the elements Select picked show in the app. */
	elements: readonly PreviewElementBox[];
	/** Takes where the elements Select picked show, again each time the app scrolls. */
	onSelection: (boxes: PreviewElementBox[]) => void;
	/** Starts picking in `mode`, switches to it, or stops picking for `null`, which drops the selection and the marks. */
	choose: (mode: PickMode | null) => void;
	/** Stops picking, `false` when it was not on, so Escape does what it does otherwise. */
	stop: () => boolean;
	/** Switches to the mode whose shortcut is `key`, pressed in the app while Select has its focus. */
	pickKey: (key: string) => void;
	/** Adds `marking` and the selected elements to the composer as one chip and its picture, and stops picking once it did. */
	attach: (marking: Marking) => Promise<void>;
	/** Attaches a picture of all the page shows to the composer. */
	screenshot: () => Promise<void>;
}

/**
 * The picking session of the Browser that `webview` drives, as T3 Code's: Select picks elements in the app; Region,
 * Draw, and Erase mark the page; one **Attach** sends them all to the composer of `draftKey`. The modes' shortcuts
 * switch the mode while picking.
 */
export function usePicking(webview: Webview, draftKey: string): PickingSession {
	const [mode, setMode] = useState<PickMode | null>(null);
	const [color, setColor] = useState("");
	const [elements, setElements] = useState<PreviewElementBox[]>([]);
	const choose = (next: PickMode | null): void => {
		setMode(next);
		if (next === null) return webview.clearSelection();
		const accent = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
		setColor(accent);
		webview.select(next === "select", accent);
	};
	useShortcuts(Object.fromEntries(MODES.map(item => [item.shortcut, () => (mode === null ? false : choose(item.mode))])));
	/** Attaches `file` to the composer, or says to open the conversation when none is mounted; whether it attached. */
	const attachFile = (file: File): boolean => {
		const attached = attachToComposer(draftKey, file);
		toasts.add({ title: attached ? "Added to the composer" : "Open the session's conversation to attach the capture" });
		return attached;
	};
	return {
		mode,
		color,
		elements,
		onSelection: setElements,
		choose,
		stop: () => {
			if (mode === null) return false;
			choose(null);
			return true;
		},
		pickKey: key => {
			const item = MODES.find(({ shortcut }) => shortcutBindings(shortcut).some(binding => "chord" in binding && binding.chord.key === key));
			if (mode !== null && item) choose(item.mode);
		},
		// Picking stops only once the chip and its picture are in the composer, so a failed capture or a closed conversation keeps the marks to try again.
		attach: async ({ marks, comment, pageWidth }) => {
			const picked = await webview.resolveSelection();
			const png = await webview.capture();
			if (png === null) return void toasts.add({ title: "Could not capture the Browser" });
			const boxes = elements.filter(box => picked.some(element => element.id === box.id));
			if (!attachFile(await annotationFile(png, marks, boxes, pageWidth, color))) return;
			choose(null);
			const regions = marks.filter(mark => mark.kind === "region").length;
			const { label, content } = annotationText({ comment, page: webview.page(), elements: picked, regions, strokes: marks.length - regions });
			appendToComposer(draftKey, annotationReference(label, content));
		},
		screenshot: async () => {
			const png = await webview.capture();
			if (png === null) return void toasts.add({ title: "Could not capture the Browser" });
			attachFile(screenshotFile(png));
		},
	};
}

const pathOf = (points: readonly Point[]): string => points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");

/** What Region or Draw is drawing while the pointer is down. */
type Drawing = { kind: "region"; from: Point; to: Point } | { kind: "stroke"; points: Point[] };

interface PickingProps {
	mode: PickMode;
	/** What the marks are drawn in, as the app's outlines are. */
	color: string;
	/** Where the elements Select picked show, which the card sits beside and Erase removes. */
	elements: readonly PreviewElementBox[];
	onMode: (mode: PickMode) => void;
	onDeselect: (id: number) => void;
	onAttach: (marking: Marking) => void;
}

/**
 * Covers the page while picking, with the switch between the modes floating at its top: Region drags a box, Draw a
 * line, and Erase removes the mark or selected element it clicks, until **Attach** in the card beside them. Under
 * Select, it lets the pointer through to the app and still shows the marks.
 */
export function Picking({ mode, color, elements, onMode, onDeselect, onAttach }: PickingProps) {
	const [marks, setMarks] = useState<Mark[]>([]);
	const [drawing, setDrawing] = useState<Drawing | null>(null);
	const [comment, setComment] = useState("");
	const layerRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const nextId = useRef(0);
	const [place, setPlace] = useState<Point | null>(null);
	const pointOf = (event: PointerEvent): Point => {
		const box = event.currentTarget.getBoundingClientRect();
		return { x: event.clientX - box.left, y: event.clientY - box.top };
	};
	const bounds = boundsOf([...marks.map(mark => mark.area), ...elements]);

	// The card measures itself before it shows, so it lands beside the marks on the first frame.
	useLayoutEffect(() => {
		const layer = layerRef.current;
		const card = cardRef.current;
		if (!bounds || !layer || !card) return setPlace(null);
		const next = cardPlace(bounds, { width: card.offsetWidth, height: card.offsetHeight }, layer.clientWidth, layer.clientHeight);
		setPlace(current => (current?.x === next.x && current.y === next.y ? current : next));
	}, [bounds?.x, bounds?.y, bounds?.width, bounds?.height]);

	const attach = (): void => {
		const layer = layerRef.current;
		if ((marks.length === 0 && elements.length === 0) || !layer) return;
		onAttach({ marks, comment: comment.trim(), pageWidth: layer.clientWidth });
	};
	const drawingArea = drawing?.kind === "region" && layerRef.current ? dragArea(drawing.from, drawing.to, layerRef.current.clientWidth, layerRef.current.clientHeight) : null;

	return (
		<>
			<div
				ref={layerRef}
				role="presentation"
				className={cn(
					"absolute inset-0 z-10 touch-none overflow-hidden select-none",
					mode === "select" ? "pointer-events-none" : mode === "erase" ? "cursor-default" : "cursor-crosshair",
				)}
				style={{ color }}
				onPointerDown={event => {
					if (event.button !== 0 || event.target !== event.currentTarget) return;
					const at = pointOf(event);
					if (mode === "erase") {
						const hit = markAt(marks, at);
						const element = hit ? undefined : elementAt(elements, at);
						if (hit) setMarks(marks.filter(mark => mark !== hit));
						else if (element) onDeselect(element.id);
						return;
					}
					event.currentTarget.setPointerCapture(event.pointerId);
					setDrawing(mode === "draw" ? { kind: "stroke", points: [at] } : { kind: "region", from: at, to: at });
				}}
				onPointerMove={event => {
					if (!drawing) return;
					const at = pointOf(event);
					setDrawing(drawing.kind === "stroke" ? { kind: "stroke", points: [...drawing.points, at] } : { ...drawing, to: at });
				}}
				onPointerUp={event => {
					if (!drawing) return;
					setDrawing(null);
					const id = nextId.current++;
					const { clientWidth, clientHeight } = event.currentTarget;
					if (drawing.kind === "stroke") {
						const area = strokeArea(drawing.points);
						if (area && drawing.points.length > 1) setMarks([...marks, { kind: "stroke", id, points: drawing.points, area }]);
						return;
					}
					const area = dragArea(drawing.from, pointOf(event), clientWidth, clientHeight);
					if (area) setMarks([...marks, { kind: "region", id, area }]);
				}}
			>
				<svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
					{marks.map(mark =>
						mark.kind === "region" ? (
							<rect key={mark.id} {...rectProps(mark.area)} className="fill-current/6 stroke-current" strokeWidth={2} />
						) : (
							<path key={mark.id} d={pathOf(mark.points)} className="fill-none stroke-current" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
						),
					)}
					{drawingArea && <rect {...rectProps(drawingArea)} className="fill-current/6 stroke-current" strokeWidth={2} />}
					{drawing?.kind === "stroke" && (
						<path d={pathOf(drawing.points)} className="fill-none stroke-current" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
					)}
				</svg>
				{(marks.length > 0 || elements.length > 0) && (
					<div
						ref={cardRef}
						className={cn(
							"pointer-events-auto absolute flex w-[min(360px,calc(100%-16px))] cursor-default items-start gap-2 rounded-xl border border-border bg-popover/95 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl",
							place === null && "invisible",
						)}
						style={{ left: place?.x ?? 0, top: place?.y ?? 0 }}
					>
						<textarea
							// Focused once the first mark is drawn or element selected, as in T3 Code, so the comment is typed next.
							autoFocus
							rows={1}
							value={comment}
							placeholder="Describe the change…"
							aria-label="Comment on the marks"
							className="field-sizing-content max-h-24 min-h-8 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
							onChange={event => setComment(event.target.value)}
							onKeyDown={event => {
								if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
								event.preventDefault();
								attach();
							}}
						/>
						<Button {...activityControl("browser.annotation.attach")} size="compact" className="mt-0.5 shrink-0" onClick={attach}>
							Attach
						</Button>
					</div>
				)}
			</div>
			<div
				role="radiogroup"
				aria-label="Pick mode"
				className="absolute top-2.5 left-1/2 z-20 flex -translate-x-1/2 gap-0.5 rounded-lg border border-border bg-popover/95 p-1 text-popover-foreground shadow-lg backdrop-blur-xl"
			>
				{MODES.map(item => (
					<button
						key={item.mode}
						{...activityControl(item.control)}
						type="button"
						role="radio"
						aria-checked={item.mode === mode}
						title={`${item.hint} (${shortcutKeys(item.shortcut)})`}
						className={cn(
							"h-7 rounded-md px-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
							item.mode === mode && "bg-primary/10 text-primary hover:bg-primary/10",
						)}
						onClick={() => onMode(item.mode)}
					>
						{item.label}
					</button>
				))}
			</div>
		</>
	);
}

const rectProps = (area: Area) => ({ x: area.x, y: area.y, width: area.width, height: area.height });
