/**
 * The Browser's picking, as T3 Code has it: the Select, Region, Draw, and Erase switch over the page, the layer where
 * Region boxes and Draw lines mark the page and the card that attaches them with the selected elements, and the image
 * files the composer attaches of the page.
 */
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ControlId } from "../../src/shared/activity";
import { activityControl } from "../activity";
import { type Area, cardPlace, dragArea, elementAt, type Mark, markAt, type Point, STROKE_WIDTH, strokeArea, unionArea } from "../browser-model";
import type { PreviewElementBox } from "../../src/shared/desktop-bridge";
import { type ShortcutId, shortcutKeys } from "../shortcuts";

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

/** The switch between the modes, floating at the top of the page while picking. */
export function PickModes({ mode, onChange }: { mode: PickMode; onChange: (mode: PickMode) => void }) {
	return (
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
					onClick={() => onChange(item.mode)}
				>
					{item.label}
				</button>
			))}
		</div>
	);
}

const fileName = (what: string): string => `Browser ${what} ${new Date().toLocaleTimeString()}.png`;

/** `png`, all the page shows, as an image file to attach. */
export const screenshotFile = (png: Uint8Array): File => new File([new Uint8Array(png)], fileName("screenshot"), { type: "image/png" });

/**
 * `png`, all the page shows at the screen's density, with `marks` drawn on it in `color`, cut to the marks, the
 * `elements`, whose outlines the app drew itself, and a margin around them, as an image file to attach. `pageWidth` is
 * the page's CSS width, which gives the density.
 */
export async function annotationFile(png: Uint8Array, marks: readonly Mark[], elements: readonly Area[], pageWidth: number, color: string): Promise<File> {
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

const pathOf = (points: readonly Point[]): string => points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");

/** What Region or Draw is drawing while the pointer is down. */
type Drawing = { kind: "region"; from: Point; to: Point } | { kind: "stroke"; points: Point[] };

interface AnnotationLayerProps {
	mode: PickMode;
	/** Where the elements Select picked show, which the card sits beside and Erase removes. */
	elements: readonly PreviewElementBox[];
	onDeselect: (id: number) => void;
	/** Takes the marks, the comment typed beside them, the page's CSS width, and the color they were drawn in. */
	onAttach: (marks: Mark[], comment: string, pageWidth: number, color: string) => void;
}

/**
 * Covers the page while picking: Region drags a box, Draw a line, and Erase removes the mark or selected element it
 * clicks, until **Attach** in the card beside them. Under Select, it lets the pointer through to the app and still
 * shows the marks.
 */
export function AnnotationLayer({ mode, elements, onDeselect, onAttach }: AnnotationLayerProps) {
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
	const bounds = unionArea(
		[...marks.map(mark => mark.area), ...elements],
		0,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	);

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
		onAttach(marks, comment.trim(), layer.clientWidth, getComputedStyle(layer).color);
	};
	const drawingArea = drawing?.kind === "region" && layerRef.current ? dragArea(drawing.from, drawing.to, layerRef.current.clientWidth, layerRef.current.clientHeight) : null;

	return (
		<div
			ref={layerRef}
			role="presentation"
			className={cn(
				"absolute inset-0 z-10 touch-none overflow-hidden text-primary select-none",
				mode === "select" ? "pointer-events-none" : mode === "erase" ? "cursor-default" : "cursor-crosshair",
			)}
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
					if (drawing.points.length > 1) setMarks([...marks, { kind: "stroke", id, points: drawing.points, area: strokeArea(drawing.points) }]);
					return;
				}
				const area = dragArea(drawing.from, pointOf(event), clientWidth, clientHeight);
				if (area && area.width >= 1 && area.height >= 1) setMarks([...marks, { kind: "region", id, area }]);
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
	);
}

const rectProps = (area: Area) => ({ x: area.x, y: area.y, width: area.width, height: area.height });
