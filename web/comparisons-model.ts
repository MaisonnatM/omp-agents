import type { ComparisonSnapshot, VariantScreenshot } from "../src/shared/comparisons";

export interface ScreenshotPreview {
	shown: VariantScreenshot | null;
	requested: VariantScreenshot | null;
	failed: boolean;
}
export type ScreenshotEvent = { kind: "publish" | "loaded" | "failed"; screenshot: VariantScreenshot };
export const EMPTY_SCREENSHOT: ScreenshotPreview = { shown: null, requested: null, failed: false };

export function screenshotPreview(state: ScreenshotPreview, event: ScreenshotEvent): ScreenshotPreview {
	if (event.kind === "publish") {
		if (state.requested !== null && state.requested.sequence >= event.screenshot.sequence) return state;
		return { ...state, requested: event.screenshot, failed: false };
	}
	if (state.requested?.sequence !== event.screenshot.sequence) return state;
	return event.kind === "loaded" ? { shown: event.screenshot, requested: event.screenshot, failed: false } : { ...state, failed: true };
}

export function cleanupRemaining(comparison: ComparisonSnapshot): number {
	return comparison.variants.filter(variant => variant.id !== comparison.winner && variant.lifecycle.kind !== "removed").length;
}
