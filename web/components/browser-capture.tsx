/**
 * The Browser's **Capture area**: a crosshair layer over its page where a drag picks an area and a click the whole
 * page, as macOS's Cmd+Shift+4 does, and the file the composer attaches of it.
 */
import { type PointerEvent, useState } from "react";
import { type Area, dragArea, type Point } from "../browser-model";

/** `png`, the whole page at the screen's density, cut to `area` of a page `pageWidth` CSS pixels wide, as an image file to attach. */
export async function captureFile(png: Uint8Array, area: Area | null, pageWidth: number): Promise<File> {
	const name = `Browser capture ${new Date().toLocaleTimeString()}.png`;
	const whole = new Blob([new Uint8Array(png)], { type: "image/png" });
	if (area === null) return new File([whole], name, { type: "image/png" });
	const bitmap = await createImageBitmap(whole);
	const scale = bitmap.width / pageWidth;
	const width = Math.max(1, Math.round(area.width * scale));
	const height = Math.max(1, Math.round(area.height * scale));
	const canvas = new OffscreenCanvas(width, height);
	canvas.getContext("2d")?.drawImage(bitmap, Math.round(area.x * scale), Math.round(area.y * scale), width, height, 0, 0, width, height);
	bitmap.close();
	return new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" });
}

/** Covers the page until a drag or a click ends, then hands `onArea` the area, `null` for the whole page, and the page's CSS width. */
export function CaptureLayer({ onArea }: { onArea: (area: Area | null, pageWidth: number) => void }) {
	// The page's size, taken as the drag starts, is what the area stays inside.
	const [drag, setDrag] = useState<{ from: Point; to: Point; width: number; height: number } | null>(null);
	const pointOf = (event: PointerEvent): Point => {
		const box = event.currentTarget.getBoundingClientRect();
		return { x: event.clientX - box.left, y: event.clientY - box.top };
	};
	const shown = drag && dragArea(drag.from, drag.to, drag.width, drag.height);

	return (
		<div
			role="presentation"
			className="absolute inset-0 z-10 cursor-crosshair touch-none overflow-hidden select-none"
			onPointerDown={event => {
				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				const at = pointOf(event);
				const { width, height } = event.currentTarget.getBoundingClientRect();
				setDrag({ from: at, to: at, width, height });
			}}
			onPointerMove={event => {
				if (drag) setDrag({ ...drag, to: pointOf(event) });
			}}
			onPointerUp={event => {
				if (!drag) return;
				setDrag(null);
				onArea(dragArea(drag.from, pointOf(event), drag.width, drag.height), drag.width);
			}}
		>
			{shown ? (
				<div
					className="pointer-events-none absolute border border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.35)] outline outline-1 outline-black/50"
					style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }}
				>
					<span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white tabular-nums">
						{Math.round(shown.width)} × {Math.round(shown.height)}
					</span>
				</div>
			) : (
				<div className="pointer-events-none absolute inset-0 flex justify-center bg-black/10 px-3 pt-3">
					<p className="h-fit rounded-md bg-popover px-2.5 py-1 text-center text-xs text-balance text-popover-foreground shadow-md">Drag over an area, or click to capture the whole page. Esc cancels.</p>
				</div>
			)}
		</div>
	);
}
