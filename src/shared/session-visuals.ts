/**
 * The fenced blocks a session's conversation draws as visuals, `mermaid` and `chart`, and the rules each source must
 * meet. The page checks a fence with these before it draws it, and the dashboard's omp extension tells the model the
 * same limits.
 */
import { isObject, type Parsed } from "../json";

export const MAX_MERMAID_SOURCE = 20_000;
export const MAX_CHART_SERIES = 5;
export const MAX_CHART_ROWS = 500;

type Checked<T> = Parsed<T, { error: string }>;

const fail = (error: string): { error: string } => ({ error });

export type MermaidKind = "flowchart" | "sequence" | "state" | "class" | "er";

/** What a reader calls each kind, for a diagram's alt text. */
export const MERMAID_KIND_NAMES: Record<MermaidKind, string> = {
	flowchart: "Flowchart",
	sequence: "Sequence diagram",
	state: "State diagram",
	class: "Class diagram",
	er: "Entity relationship diagram",
};

/** The header line of each kind beautiful-mermaid draws, read as its `detectDiagramType` reads it: trimmed and in lower case. */
const MERMAID_HEADERS: readonly (readonly [MermaidKind, RegExp])[] = [
	["flowchart", /^(?:graph|flowchart)\s+(?:td|tb|lr|bt|rl)$/],
	["sequence", /^sequencediagram$/],
	["state", /^statediagram(?:-v2)?$/],
	["class", /^classdiagram$/],
	["er", /^erdiagram$/],
];

/** The kind of the diagram `source` draws, by its first line, or why the page does not draw it. */
export function mermaidKind(source: string): Checked<MermaidKind> {
	if (source.length > MAX_MERMAID_SOURCE) return fail(`A diagram is limited to ${MAX_MERMAID_SOURCE.toLocaleString("en-US")} characters.`);
	const header = (source.trim().split(/[\n;]/)[0] ?? "").trim().toLowerCase();
	const kind = MERMAID_HEADERS.find(([, pattern]) => pattern.test(header))?.[0];
	if (kind) return { ok: kind };
	if (header === "") return fail("The diagram is empty.");
	return fail(`"${header.split(/\s/)[0]}" is not a supported diagram type. Use a flowchart, sequence, state, class, or ER diagram.`);
}

export const CHART_TYPES = ["bar", "line", "area", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSeries {
	key: string;
	/** The series' name in the legend and tooltip: its `label`, else its key. */
	label: string;
}

/** One row: its `x` value, a string or a number, and a finite number for each series. */
export type ChartRow = Record<string, string | number>;

export interface ChartSpec {
	type: ChartType;
	title: string | null;
	description: string | null;
	/** The key of each row's category: the x axis, or a pie's slice name. */
	x: string;
	/** One to five; a pie has exactly one. */
	series: ChartSeries[];
	data: ChartRow[];
}

const SPEC_KEYS = ["type", "title", "description", "x", "series", "data"];
const SERIES_KEYS = ["key", "label"];
/** A row key, which also names a CSS custom property of the chart's colors, so it holds nothing CSS would read as syntax. */
const KEY = /^[A-Za-z_][\w-]{0,63}$/;
const KEY_RULE = "letters, digits, _ and -, starting with a letter or _";

const unknownKey = (value: Record<string, unknown>, allowed: readonly string[]): string | undefined => Object.keys(value).find(key => !allowed.includes(key));
const optionalText = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseSeries(raw: unknown, x: string, pie: boolean): Checked<ChartSeries[]> {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHART_SERIES) return fail(`"series" must list 1 to ${MAX_CHART_SERIES} series.`);
	if (pie && raw.length !== 1) return fail("A pie chart takes exactly one series.");
	const series: ChartSeries[] = [];
	for (const [index, entry] of raw.entries()) {
		const at = `Series ${index + 1}`;
		if (!isObject(entry)) return fail(`${at} must be an object with "key" and an optional "label".`);
		const extra = unknownKey(entry, SERIES_KEYS);
		if (extra !== undefined) return fail(`${at} has the unknown key "${extra}".`);
		const { key, label } = entry;
		if (typeof key !== "string" || !KEY.test(key)) return fail(`${at} needs a "key" of ${KEY_RULE}.`);
		if (key === x) return fail(`${at} uses the "x" key "${x}".`);
		if (series.some(other => other.key === key)) return fail(`${at} repeats the key "${key}".`);
		if (!optionalText(label)) return fail(`${at}'s "label" must be a string.`);
		series.push({ key, label: label ?? key });
	}
	return { ok: series };
}

function parseRows(raw: unknown, x: string, series: readonly ChartSeries[]): Checked<ChartRow[]> {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHART_ROWS) return fail(`"data" must list 1 to ${MAX_CHART_ROWS} rows.`);
	const allowed = [x, ...series.map(entry => entry.key)];
	const rows: ChartRow[] = [];
	for (const [index, row] of raw.entries()) {
		const at = `Row ${index + 1}`;
		if (!isObject(row)) return fail(`${at} must be an object.`);
		const extra = unknownKey(row, allowed);
		if (extra !== undefined) return fail(`${at} has the unknown key "${extra}".`);
		const category = row[x];
		if (typeof category !== "string" && !isFiniteNumber(category)) return fail(`${at} needs "${x}" as a string or a finite number.`);
		for (const { key } of series) {
			if (!Object.hasOwn(row, key)) return fail(`${at} has no "${key}".`);
			if (!isFiniteNumber(row[key])) return fail(`${at}'s "${key}" must be a finite number.`);
		}
		// Every key was just checked: `x` holds a string or a number, and each series key a finite number.
		rows.push(row as ChartRow);
	}
	return { ok: rows };
}

/** The chart a `chart` fence's JSON describes, or the first rule it breaks. */
export function parseChartSpec(source: string): Checked<ChartSpec> {
	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch (error) {
		return fail(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isObject(raw) || Array.isArray(raw)) return fail("A chart is one JSON object.");
	const extra = unknownKey(raw, SPEC_KEYS);
	if (extra !== undefined) return fail(`Unknown key "${extra}".`);
	const { type, title, description, x } = raw;
	const chartType = CHART_TYPES.find(name => name === type);
	if (!chartType) return fail(`"type" must be "bar", "line", "area", or "pie".`);
	if (!optionalText(title)) return fail(`"title" must be a string.`);
	if (!optionalText(description)) return fail(`"description" must be a string.`);
	if (typeof x !== "string" || !KEY.test(x)) return fail(`"x" must name the rows' category key, of ${KEY_RULE}.`);
	const series = parseSeries(raw.series, x, chartType === "pie");
	if ("error" in series) return series;
	const data = parseRows(raw.data, x, series.ok);
	if ("error" in data) return data;
	return { ok: { type: chartType, title: title ?? null, description: description ?? null, x, series: series.ok, data: data.ok } };
}
