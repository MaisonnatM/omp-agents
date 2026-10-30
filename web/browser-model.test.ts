import { expect, test } from "bun:test";
import type { LiveSessionProcesses, SessionProcess } from "../src/shared/processes";
import { annotationText, boundsOf, browserCandidates, cardPlace, devServers, dragArea, elementAt, initialAddress, type Mark, markAt, strokeArea, unionArea } from "./browser-model";

const running = (label: string, ports: number[], shared = false): SessionProcess => ({
	id: label, kind: shared ? "service" : "job", shared, label, memoryBytes: 0, cpuPercent: 0, processCount: 1, ports, startedAt: 0, stopsAt: null,
});
const session = (instanceId: string, processes: SessionProcess[]): LiveSessionProcesses => ({
	instanceId, omp: { memoryBytes: 0, cpuPercent: 0, processCount: 1 }, processes, otherPorts: [],
});

test("a session's dev servers are its own listening processes, in the CPU card's order, without a shared daemon", () => {
	const sessions = [
		session("other", [running("rails server", [3000])]),
		session("mine", [running("vite", [5173, 24678]), running("browser", [9222], true), running("sleep 600", []), running("api", [4000])]),
	];
	expect(devServers(sessions, "mine")).toEqual([
		{ id: "vite", label: "vite", ports: [5173, 24678] },
		{ id: "api", label: "api", ports: [4000] },
	]);
	expect(devServers(sessions, "gone")).toEqual([]);
	expect(devServers(null, "mine")).toEqual([]);
});

test("a session's candidates are every port its dev servers listen on, in their order", () => {
	expect(browserCandidates([{ id: "vite", label: "vite", ports: [5173, 24678] }, { id: "api", label: "api", ports: [4000] }])).toEqual([
		{ url: "http://localhost:5173/", label: "vite", port: 5173 },
		{ url: "http://localhost:24678/", label: "vite", port: 24678 },
		{ url: "http://localhost:4000/", label: "api", port: 4000 },
	]);
	expect(browserCandidates([])).toEqual([]);
});

test("the Browser opens on the address last loaded, else the first candidate, else none", () => {
	const candidates = browserCandidates(devServers([session("mine", [running("vite", [5173])])], "mine"));
	expect(initialAddress("http://127.0.0.1:3000/settings", candidates)).toBe("http://127.0.0.1:3000/settings");
	expect(initialAddress(null, candidates)).toBe("http://localhost:5173/");
	expect(initialAddress("https://example.com/", candidates)).toBe("http://localhost:5173/");
	expect(initialAddress(null, [])).toBeNull();
});

test("a drag marks the area it covers inside the page, whichever way it goes, and a click or a drag off the page marks none", () => {
	expect(dragArea({ x: 10, y: 10 }, { x: 12, y: 13 }, 800, 600)).toBeNull();
	expect(dragArea({ x: 300, y: 200 }, { x: 100, y: 50 }, 800, 600)).toEqual({ x: 100, y: 50, width: 200, height: 150 });
	expect(dragArea({ x: 700, y: 500 }, { x: 900, y: -40 }, 800, 600)).toEqual({ x: 700, y: 0, width: 100, height: 500 });
	expect(dragArea({ x: -60, y: 100 }, { x: -10, y: 300 }, 800, 600)).toBeNull();
});

test("the picture covers every mark and element with a margin that stops at the page's edges", () => {
	const areas = [{ x: 4, y: 100, width: 50, height: 50 }, { x: 300, y: 20, width: 100, height: 570 }];
	expect(boundsOf(areas)).toEqual({ x: 4, y: 20, width: 396, height: 570 });
	expect(unionArea(areas, 16, 800, 600)).toEqual({ x: 0, y: 4, width: 416, height: 596 });
	expect(unionArea([], 16, 800, 600)).toBeNull();
});

test("a line covers the points it goes through and its width around them", () => {
	expect(strokeArea([{ x: 10, y: 40 }, { x: 30, y: 20 }])).toEqual({ x: 8, y: 18, width: 24, height: 24 });
	expect(strokeArea([])).toBeNull();
});

test("Erase takes the last mark drawn at the point, and the innermost selected element", () => {
	const area = { x: 0, y: 0, width: 100, height: 100 };
	const marks: Mark[] = [{ kind: "region", id: 1, area }, { kind: "stroke", id: 2, points: [], area }];
	expect(markAt(marks, { x: 50, y: 50 })?.id).toBe(2);
	expect(markAt(marks, { x: 150, y: 50 })).toBeNull();
	const card = { id: 1, x: 0, y: 0, width: 300, height: 200 };
	const button = { id: 2, x: 20, y: 150, width: 80, height: 30 };
	expect(elementAt([card, button], { x: 40, y: 160 })?.id).toBe(2);
	expect(elementAt([card, button], { x: 200, y: 50 })?.id).toBe(1);
	expect(elementAt([card, button], { x: 400, y: 50 })).toBeUndefined();
});

test("the card sits right of the marks, else left of them, else below, and always inside the page", () => {
	const size = { width: 300, height: 60 };
	expect(cardPlace({ x: 100, y: 100, width: 100, height: 50 }, size, 1000, 600)).toEqual({ x: 208, y: 100 });
	expect(cardPlace({ x: 600, y: 100, width: 300, height: 50 }, size, 1000, 600)).toEqual({ x: 292, y: 100 });
	expect(cardPlace({ x: 0, y: 0, width: 1000, height: 600 }, size, 1000, 600)).toEqual({ x: 692, y: 532 });
});

test("an annotation's chip is named after the comment, else its elements, else the page", () => {
	const page = { url: "http://localhost:5173/cart", title: "Cart" };
	const buy = { name: "BuyButton", snippet: "<button>Buy</button>" };
	const card = { name: "ProductCard", snippet: "<section>…</section>" };
	const base = { comment: "", page, elements: [], regions: 0, strokes: 0 };
	expect(annotationText({ ...base, comment: "  make it\n blue ", elements: [buy] }).label).toBe("make it blue");
	expect(annotationText({ ...base, elements: [buy, card] }).label).toBe("BuyButton +1");
	expect(annotationText({ ...base, elements: [buy] }).label).toBe("BuyButton");
	expect(annotationText({ ...base, regions: 1 }).label).toBe("Cart");
	expect(annotationText({ ...base, page: { ...page, title: " " }, regions: 1 }).label).toBe("Browser annotation");
});

test("an annotation's text gives the comment, the page, each element, and what the picture marks", () => {
	const { content } = annotationText({
		comment: "match card B",
		page: { url: "http://localhost:5173/", title: "Shop" },
		elements: [{ name: "BuyButton", snippet: "<button>Buy</button>" }],
		regions: 2,
		strokes: 1,
	});
	expect(content).toBe(
		"match card B\n\nAnnotated in the Browser on http://localhost:5173/ (Shop).\n\nElement 1, BuyButton:\n<button>Buy</button>\n\nThe attached picture shows 1 outlined element, 2 boxes, 1 line.",
	);
});
