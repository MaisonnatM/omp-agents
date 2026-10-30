import { describe, expect, test } from "bun:test";
import type { Item } from "../src/shared/transcript";
import { latestReviewPages, MAX_REVIEW_PAGES, parseReviewPages, samePages } from "./review-pages";

const reply = (id: string, text: string, streaming = false): Item => ({ id, kind: "assistant", text, streaming, suggestions: [] });
const fence = (pages: unknown): string => `Done.\n\n\`\`\`review-pages\n${JSON.stringify(pages)}\n\`\`\``;

describe("parseReviewPages", () => {
	test("keeps pages on this computer, labels unlabeled ones by address, and trims notes", () => {
		expect(
			parseReviewPages(
				JSON.stringify([
					{ label: " Sync ", url: "http://localhost:5173/#settings/sync" },
					{ label: "Elsewhere", url: "https://example.com/" },
					{ url: "http://127.0.0.1:5173/menu", note: " Open the avatar menu " },
					{ label: "Again", url: "http://localhost:5173/#settings/sync" },
					"not a page",
				]),
			),
		).toEqual([
			{ label: "Sync", url: "http://localhost:5173/#settings/sync", note: null },
			{ label: "http://127.0.0.1:5173/menu", url: "http://127.0.0.1:5173/menu", note: "Open the avatar menu" },
		]);
	});

	test("opens at most the cap", () => {
		const many = Array.from({ length: 12 }, (_, at) => ({ label: `Page ${at}`, url: `http://localhost:3000/${at}` }));
		expect(parseReviewPages(JSON.stringify(many))?.map(page => page.label)).toEqual(Array.from({ length: MAX_REVIEW_PAGES }, (_, at) => `Page ${at}`));
	});

	test("refuses what is not a JSON array", () => {
		expect(parseReviewPages("[{")).toBeNull();
		expect(parseReviewPages('{"url": "http://localhost:3000/"}')).toBeNull();
	});
});

describe("latestReviewPages", () => {
	test("reads the last valid list of a settled reply", () => {
		const items = [
			reply("a", fence([{ label: "Old", url: "http://localhost:3000/old" }])),
			reply("b", `${fence([{ label: "New", url: "http://localhost:3000/new" }])}\n\n\`\`\`review-pages\n[{\n\`\`\``),
			reply("c", fence([{ label: "Typing", url: "http://localhost:3000/typing" }]), true),
		];
		expect(latestReviewPages(items)).toEqual([{ label: "New", url: "http://localhost:3000/new", note: null }]);
	});

	test("lists nothing before a reply names pages", () => {
		expect(latestReviewPages([reply("a", "No visual change.")])).toEqual([]);
	});
});

describe("samePages", () => {
	const home = { label: "Home", url: "http://localhost:3000/", note: null };
	test("matches the same pages in the same order", () => {
		expect(samePages([home], [{ ...home }])).toBe(true);
	});

	test("tells apart a changed label, note, order, or length", () => {
		const menu = { label: "Menu", url: "http://localhost:3000/menu", note: null };
		expect(samePages([home], [{ ...home, label: "Start" }])).toBe(false);
		expect(samePages([home], [{ ...home, note: "Open the menu" }])).toBe(false);
		expect(samePages([home, menu], [menu, home])).toBe(false);
		expect(samePages([home], [home, menu])).toBe(false);
	});
});
