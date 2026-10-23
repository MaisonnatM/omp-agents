import { Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, Cell, XAxis, YAxis } from "recharts";
import { errorText } from "../../src/json";
import { type ChartSpec, type ChartType, type MermaidKind, MERMAID_KIND_NAMES, mermaidKind, parseChartSpec } from "../../src/shared/session-visuals";
import { useDarkClass } from "../theme";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ViewerDialog } from "./viewer-dialog";

/** The fence languages a session's conversation draws as a visual. */
export type VisualLanguage = "mermaid" | "chart";

export const isVisualLanguage = (language: string | null): language is VisualLanguage => language === "mermaid" || language === "chart";

/** What a fence's source checks to: the visual it draws, or why it stays source. */
type Visual = { kind: "mermaid"; diagram: MermaidKind } | { kind: "chart"; spec: ChartSpec } | { kind: "invalid"; error: string };

function visualOf(language: VisualLanguage, source: string): Visual {
	if (language === "mermaid") {
		const diagram = mermaidKind(source);
		return "ok" in diagram ? { kind: "mermaid", diagram: diagram.ok } : { kind: "invalid", error: diagram.error };
	}
	const spec = parseChartSpec(source);
	return "ok" in spec ? { kind: "chart", spec: spec.ok } : { kind: "invalid", error: spec.error };
}

const CHART_NAMES: Record<ChartType, string> = { bar: "Bar chart", line: "Line chart", area: "Area chart", pie: "Pie chart" };

/**
 * A `mermaid` or `chart` fence in a session's message, drawn once the message settles. `code` is the fence's
 * highlighted lines, which the Source view and a fence the page cannot draw show; Copy always copies `source`.
 */
export function SessionVisual({ language, source, code }: { language: VisualLanguage; source: string; code: ReactNode }) {
	const visual = useMemo(() => visualOf(language, source), [language, source]);
	switch (visual.kind) {
		case "invalid":
			return <VisualFrame language={language} title={language} source={source} code={code} body={{ kind: "failed", error: visual.error }} />;
		case "mermaid":
			return <MermaidVisual kind={visual.diagram} source={source} code={code} />;
		case "chart": {
			const { spec } = visual;
			const name = CHART_NAMES[spec.type];
			const title = spec.title ?? name;
			const chart = (expanded: boolean) => <ChartView spec={spec} label={title} expanded={expanded} />;
			return (
				<VisualFrame
					language={language}
					title={title}
					description={spec.description ?? (spec.title ? name : null)}
					source={source}
					code={code}
					body={{ kind: "preview", inline: chart(false), expanded: chart(true) }}
				/>
			);
		}
	}
}

/** What a frame shows besides the source: the visual, inline and in the expanded dialog, or why there is none. */
type FrameBody = { kind: "preview"; inline: ReactNode; expanded: ReactNode } | { kind: "failed"; error: string };

interface VisualFrameProps {
	language: VisualLanguage;
	title: string;
	description?: string | null;
	source: string;
	code: ReactNode;
	body: FrameBody;
}

/** The code block a visual sits in: its title, the Preview and Source views, Copy, and Expand. */
function VisualFrame({ language, title, description = null, source, code, body }: VisualFrameProps) {
	const [view, setView] = useState<"preview" | "source">("preview");
	const [expanded, setExpanded] = useState(false);
	const copy = <CodeBlockCopyButton value={source} />;
	if (body.kind === "failed") {
		return (
			<CodeBlock>
				<CodeBlockHeader>
					<CodeBlockTitle>{title}</CodeBlockTitle>
					<CodeBlockActions>{copy}</CodeBlockActions>
				</CodeBlockHeader>
				<p role="note" className="px-3 pt-2 font-sans text-xs text-muted-foreground">
					Shown as source: {body.error}
				</p>
				<CodeBlockContent>{code}</CodeBlockContent>
			</CodeBlock>
		);
	}
	return (
		<CodeBlock>
			<CodeBlockHeader>
				<CodeBlockTitle>{title}</CodeBlockTitle>
				<CodeBlockActions>
					<div role="group" aria-label="View" className="flex items-center gap-0.5">
						{(["preview", "source"] as const).map(option => (
							<Button key={option} variant="ghost" size="xs" active={view === option} aria-pressed={view === option} onClick={() => setView(option)}>
								{option === "preview" ? "Preview" : "Source"}
							</Button>
						))}
					</div>
					{copy}
					<Tooltip content="Expand">
						<Button variant="ghost" size="icon-compact" aria-label={`Expand ${title}`} onClick={() => setExpanded(true)}>
							<Maximize2 />
						</Button>
					</Tooltip>
				</CodeBlockActions>
			</CodeBlockHeader>
			{view === "preview" ? <div className="min-w-0 px-3 py-3">{body.inline}</div> : <CodeBlockContent>{code}</CodeBlockContent>}
			{expanded && (
				<ViewerDialog title={title} description={description ?? language} actions={copy} bodyLabel={title} onClose={() => setExpanded(false)}>
					<div className="flex h-full min-h-0 items-center justify-center p-4">{body.expanded}</div>
				</ViewerDialog>
			)}
		</CodeBlock>
	);
}

type MermaidImage = { status: "rendering" } | { status: "ready"; url: string } | { status: "failed"; error: string };

/** The page's colors as the diagram's own, read where `.dark` stands now, since an image cannot read the page's variables. */
function diagramColors(): { bg: string; fg: string; muted: string } {
	const probe = document.createElement("span");
	document.body.append(probe);
	const resolve = (token: string): string => {
		probe.style.color = `var(${token})`;
		return getComputedStyle(probe).color;
	};
	try {
		return { bg: resolve("--background"), fg: resolve("--foreground"), muted: resolve("--muted-foreground") };
	} finally {
		probe.remove();
	}
}

/**
 * `source` drawn as an SVG image, again whenever the page turns light or dark. The library loads on first use; the
 * image is a blob URL, so the SVG never enters the page's DOM, and a render the source or theme outdated is dropped.
 */
function useMermaidImage(source: string): MermaidImage {
	const dark = useDarkClass();
	const [image, setImage] = useState<MermaidImage>({ status: "rendering" });
	useEffect(() => {
		let current = true;
		let url: string | null = null;
		const colors = diagramColors();
		setImage({ status: "rendering" });
		import("beautiful-mermaid")
			.then(({ renderMermaidSVGAsync }) => renderMermaidSVGAsync(source, { ...colors, transparent: true }))
			.then(
				svg => {
					if (!current) return;
					url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
					setImage({ status: "ready", url });
				},
				(error: unknown) => {
					if (current) setImage({ status: "failed", error: errorText(error) });
				},
			);
		return () => {
			current = false;
			if (url) URL.revokeObjectURL(url);
		};
	}, [source, dark]);
	return image;
}

function MermaidVisual({ kind, source, code }: { kind: MermaidKind; source: string; code: ReactNode }) {
	const image = useMermaidImage(source);
	const name = MERMAID_KIND_NAMES[kind];
	if (image.status === "failed") return <VisualFrame language="mermaid" title={name} source={source} code={code} body={{ kind: "failed", error: image.error }} />;
	const picture = (expanded: boolean) =>
		image.status === "ready" ? (
			<img src={image.url} alt={name} className={cn("mx-auto h-auto w-auto max-w-full", expanded ? "max-h-full" : "max-h-[32rem]")} />
		) : (
			<div role="status" className="flex h-32 items-center justify-center text-xs text-muted-foreground">
				Drawing the diagram…
			</div>
		);
	return <VisualFrame language="mermaid" title={name} source={source} code={code} body={{ kind: "preview", inline: picture(false), expanded: picture(true) }} />;
}

/** How each cartesian chart draws one series, as shadcn's chart examples do. */
const CARTESIAN = {
	bar: { Chart: BarChart, mark: (key: string, color: string) => <Bar key={key} dataKey={key} fill={color} radius={4} /> },
	line: { Chart: LineChart, mark: (key: string, color: string) => <Line key={key} dataKey={key} type="natural" stroke={color} strokeWidth={2} dot={false} /> },
	area: { Chart: AreaChart, mark: (key: string, color: string) => <Area key={key} dataKey={key} type="natural" stroke={color} fill={color} fillOpacity={0.4} /> },
};

const chartColor = (index: number): string => `var(--chart-${(index % 5) + 1})`;

function ChartView({ spec, label, expanded }: { spec: ChartSpec; label: string; expanded: boolean }) {
	if (spec.type === "pie") {
		const [series] = spec.series;
		// Keyed by slice name, which the spec does not limit, so no name reads an inherited property.
		const config: ChartConfig = Object.create(null);
		config[series.key] = { label: series.label };
		// A slice's name as text, since the tooltip and legend look a name up in `config` only when it is a string.
		const data = spec.data.map(row => ({ ...row, [spec.x]: String(row[spec.x]) }));
		for (const row of data) config[row[spec.x] as string] = { label: row[spec.x] };
		return (
			<ChartContainer config={config} role="figure" aria-label={label} className={cn("mx-auto", expanded ? "h-full max-h-[36rem] w-full" : "aspect-square max-h-[250px]")}>
				<PieChart>
					<ChartTooltip content={<ChartTooltipContent nameKey={spec.x} hideLabel />} />
					<Pie data={data} dataKey={series.key} nameKey={spec.x}>
						{data.map((_, index) => (
							<Cell key={index} fill={chartColor(index)} />
						))}
					</Pie>
					<ChartLegend content={<ChartLegendContent nameKey={spec.x} className="flex-wrap gap-2 *:basis-1/4 *:justify-center" />} />
				</PieChart>
			</ChartContainer>
		);
	}
	const { Chart, mark } = CARTESIAN[spec.type];
	const config: ChartConfig = Object.fromEntries(spec.series.map((series, index) => [series.key, { label: series.label, color: chartColor(index) }]));
	return (
		<ChartContainer config={config} role="figure" aria-label={label} className={cn("aspect-auto w-full", expanded ? "h-full max-h-[36rem]" : "h-64")}>
			<Chart accessibilityLayer data={spec.data} margin={{ left: 4, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey={spec.x} tickLine={false} axisLine={false} tickMargin={10} />
				<YAxis tickLine={false} axisLine={false} tickMargin={8} width="auto" />
				<ChartTooltip content={<ChartTooltipContent />} />
				{spec.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
				{spec.series.map(({ key }) => mark(key, `var(--color-${key})`))}
			</Chart>
		</ChartContainer>
	);
}
