import { describe, expect, test } from "bun:test";
import { mermaidKind, parseChartSpec } from "./session-visuals";

describe("mermaidKind", () => {
	test("each header beautiful-mermaid draws names its kind", () => {
		expect(mermaidKind("graph TD\n  A --> B")).toEqual({ ok: "flowchart" });
		expect(mermaidKind("  flowchart lr\nA-->B")).toEqual({ ok: "flowchart" });
		expect(mermaidKind("sequenceDiagram\n  A->>B: hi")).toEqual({ ok: "sequence" });
		expect(mermaidKind("stateDiagram-v2\n  [*] --> On")).toEqual({ ok: "state" });
		expect(mermaidKind("stateDiagram\n  [*] --> On")).toEqual({ ok: "state" });
		expect(mermaidKind("classDiagram\n  A <|-- B")).toEqual({ ok: "class" });
		expect(mermaidKind("erDiagram\n  A ||--o{ B : has")).toEqual({ ok: "er" });
	});

	test("other diagram types, a flowchart without a direction, and an empty fence are refused", () => {
		const unsupported = (name: string) => ({ error: `"${name}" is not a supported diagram type. Use a flowchart, sequence, state, class, or ER diagram.` });
		expect(mermaidKind('pie title Pets\n  "Dogs" : 3')).toEqual(unsupported("pie"));
		expect(mermaidKind("gantt\n  title Plan")).toEqual(unsupported("gantt"));
		expect(mermaidKind("xychart-beta\n  bar [1, 2]")).toEqual(unsupported("xychart-beta"));
		expect(mermaidKind("graph\n  A --> B")).toEqual(unsupported("graph"));
		expect(mermaidKind("%% a note\ngraph TD\n  A --> B")).toEqual(unsupported("%%"));
		expect(mermaidKind(" \n ")).toEqual({ error: "The diagram is empty." });
	});

	test("a source over 20,000 characters is refused before its header is read", () => {
		expect(mermaidKind(`graph TD\n${"A --> B\n".repeat(2_500)}`)).toEqual({ error: "A diagram is limited to 20,000 characters." });
		expect(mermaidKind(`graph TD\n${"A-->B\n".repeat(3_000)}`)).toEqual({ ok: "flowchart" });
	});
});

describe("parseChartSpec", () => {
	const bar = {
		type: "bar",
		title: "Visitors",
		x: "month",
		series: [{ key: "desktop", label: "Desktop" }, { key: "mobile" }],
		data: [
			{ month: "Jan", desktop: 186, mobile: 80 },
			{ month: "Feb", desktop: 305.5, mobile: -2 },
		],
	};
	const parse = (spec: object) => parseChartSpec(JSON.stringify(spec));

	test("a valid spec parses, with each missing label and text field filled", () => {
		expect(parse(bar)).toEqual({
			ok: {
				type: "bar",
				title: "Visitors",
				description: null,
				x: "month",
				series: [
					{ key: "desktop", label: "Desktop" },
					{ key: "mobile", label: "mobile" },
				],
				data: [
					{ month: "Jan", desktop: 186, mobile: 80 },
					{ month: "Feb", desktop: 305.5, mobile: -2 },
				],
			},
		});
		expect(parse({ type: "pie", x: "browser", series: [{ key: "visitors" }], data: [{ browser: "chrome", visitors: 275 }, { browser: 2024, visitors: 90 }] })).toMatchObject({
			ok: { type: "pie", x: "browser", series: [{ key: "visitors", label: "visitors" }] },
		});
	});

	test("bad JSON, a non-object, unknown keys, and a bad type or x are refused", () => {
		expect(parseChartSpec("{ type: 'bar' }")).toEqual({ error: expect.stringMatching(/^Not valid JSON: /) });
		expect(parseChartSpec("[]")).toEqual({ error: "A chart is one JSON object." });
		expect(parse({ ...bar, colors: ["red"] })).toEqual({ error: 'Unknown key "colors".' });
		expect(parse({ ...bar, type: "scatter" })).toEqual({ error: '"type" must be "bar", "line", "area", or "pie".' });
		expect(parse({ ...bar, title: 3 })).toEqual({ error: '"title" must be a string.' });
		expect(parse({ ...bar, x: "a b" })).toEqual({ error: '"x" must name the rows\' category key, of letters, digits, _ and -, starting with a letter or _.' });
	});

	test("series must be one to five safe, distinct keys, and a pie takes exactly one", () => {
		const six = Array.from({ length: 6 }, (_, at) => ({ key: `s${at}` }));
		expect(parse({ ...bar, series: six })).toEqual({ error: '"series" must list 1 to 5 series.' });
		expect(parse({ ...bar, series: [] })).toEqual({ error: '"series" must list 1 to 5 series.' });
		expect(parse({ ...bar, type: "pie" })).toEqual({ error: "A pie chart takes exactly one series." });
		expect(parse({ ...bar, series: [{ key: "desktop", color: "red" }] })).toEqual({ error: 'Series 1 has the unknown key "color".' });
		expect(parse({ ...bar, series: [{ key: "x;}body{" }] })).toEqual({ error: 'Series 1 needs a "key" of letters, digits, _ and -, starting with a letter or _.' });
		expect(parse({ ...bar, series: [{ key: "month" }] })).toEqual({ error: 'Series 1 uses the "x" key "month".' });
		expect(parse({ ...bar, series: [{ key: "desktop" }, { key: "desktop" }] })).toEqual({ error: 'Series 2 repeats the key "desktop".' });
	});

	test("rows must hold exactly x and every series as finite numbers, at most 500 of them", () => {
		const row = { month: "Jan", desktop: 1, mobile: 2 };
		expect(parse({ ...bar, data: [] })).toEqual({ error: '"data" must list 1 to 500 rows.' });
		expect(parse({ ...bar, data: Array.from({ length: 501 }, () => row) })).toEqual({ error: '"data" must list 1 to 500 rows.' });
		expect(parse({ ...bar, data: Array.from({ length: 500 }, () => row) })).toMatchObject({ ok: { type: "bar" } });
		expect(parse({ ...bar, data: [row, { ...row, tablet: 3 }] })).toEqual({ error: 'Row 2 has the unknown key "tablet".' });
		expect(parse({ ...bar, data: [{ desktop: 1, mobile: 2 }] })).toEqual({ error: 'Row 1 needs "month" as a string or a finite number.' });
		expect(parse({ ...bar, data: [{ month: "Jan", desktop: 1 }] })).toEqual({ error: 'Row 1 has no "mobile".' });
		expect(parse({ ...bar, data: [{ ...row, mobile: "2" }] })).toEqual({ error: 'Row 1\'s "mobile" must be a finite number.' });
		expect(parseChartSpec(JSON.stringify(bar).replace("186", "1e999"))).toEqual({ error: 'Row 1\'s "desktop" must be a finite number.' });
	});
});
