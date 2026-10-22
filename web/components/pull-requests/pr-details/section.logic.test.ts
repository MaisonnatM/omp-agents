import { describe, expect, test } from "bun:test";
import { sectionCollapseAnchorScrollTop } from "./section.logic";

describe("sectionCollapseAnchorScrollTop", () => {
	test("scrolls back to the section's top when its pinned heading collapses it", () => {
		expect(sectionCollapseAnchorScrollTop({ scrollTop: 900, viewportTop: 100, sectionTop: -200, headingTop: 100 })).toBe(600);
	});

	test("tolerates a heading a subpixel below the edge", () => {
		expect(sectionCollapseAnchorScrollTop({ scrollTop: 900, viewportTop: 100, sectionTop: -200, headingTop: 100.5 })).toBe(600);
	});

	test("keeps the scroll while the section's top is in view", () => {
		expect(sectionCollapseAnchorScrollTop({ scrollTop: 900, viewportTop: 100, sectionTop: 140, headingTop: 140 })).toBeNull();
	});

	test("keeps the scroll while the heading is not pinned", () => {
		expect(sectionCollapseAnchorScrollTop({ scrollTop: 900, viewportTop: 100, sectionTop: 90, headingTop: 102 })).toBeNull();
	});

	test("never scrolls above the top", () => {
		expect(sectionCollapseAnchorScrollTop({ scrollTop: 50, viewportTop: 100, sectionTop: -200, headingTop: 100 })).toBe(0);
	});
});
