import { Maximize2 } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { errorText } from "../../src/json";
import { type ChartSpec, type ChartType, type MermaidKind, MERMAID_KIND_NAMES, mermaidKind, parseChartSpec } from "../../src/shared/session-visuals";
import { useDarkClass } from "../theme";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ViewerDialog } from "./viewer-dialog";

// `recharts` is a chunk of its own, loaded when the first chart draws.
const ChartView = lazy(() => import("./session-chart").then(module => ({ default: module.ChartView })));

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
			const chart = (expanded: boolean) => (
				<Suspense fallback={<VisualPending label="Drawing the chart…" />}>
					<ChartView spec={spec} label={title} expanded={expanded} />
				</Suspense>
			);
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
			<VisualPending label="Drawing the diagram…" />
		);
	return <VisualFrame language="mermaid" title={name} source={source} code={code} body={{ kind: "preview", inline: picture(false), expanded: picture(true) }} />;
}

function VisualPending({ label }: { label: string }) {
	return (
		<div role="status" className="flex h-32 items-center justify-center text-xs text-muted-foreground">
			{label}
		</div>
	);
}
