/** `ArtifactView`: one artifact version drawn as its kind draws, or as its source; and the kind table the card and the Artifacts tab share. */
import { FileCode2, FileText, Image, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ArtifactKind } from "../../src/shared/artifacts";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { type Loaded, useArtifactText } from "../artifact-links";
import { CodeLines, MessageMarkdown } from "./message-markdown";
import { Spinner } from "./spinner";

interface RenderedProps {
	url: string;
	text: string;
	title: string;
}

/** Each kind's name, icon, and how it draws; the kind's own name also names the grammar that colors its source. */
export const ARTIFACT_KIND: Record<ArtifactKind, { label: string; icon: LucideIcon; Rendered: (props: RenderedProps) => ReactNode }> = {
	html: { label: "HTML", icon: FileCode2, Rendered: HtmlFrame },
	markdown: { label: "Markdown", icon: FileText, Rendered: MarkdownText },
	svg: { label: "SVG", icon: Image, Rendered: SvgImage },
};

/**
 * The page from its capability address, never `srcdoc` or a blob address, which would run under the dashboard's origin.
 * Without `allow-same-origin` it gets an opaque origin, so its scripts cannot reach the dashboard or its token.
 */
function HtmlFrame({ url, title }: RenderedProps) {
	return (
		<iframe
			key={url}
			src={url}
			title={title}
			sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
			referrerPolicy="no-referrer"
			className="size-full border-0 bg-white"
		/>
	);
}

function SvgImage({ url, title }: RenderedProps) {
	return (
		<div className="flex size-full items-center justify-center overflow-auto p-4">
			<img src={url} alt={title} className="size-full object-contain" />
		</div>
	);
}

function MarkdownText({ text }: RenderedProps) {
	return (
		<div className="size-full overflow-auto px-4 py-3">
			<MessageMarkdown text={text} />
		</div>
	);
}

function SourceText({ text, kind }: { text: string; kind: ArtifactKind }) {
	return (
		<CodeBlock size="sm" className="h-full rounded-none border-0">
			<CodeBlockContent wrap className="flex-1">
				<CodeLines text={text} language={kind} />
			</CodeBlockContent>
		</CodeBlock>
	);
}

function Waiting({ loaded }: { loaded: Exclude<Loaded<unknown>, { state: "ready" }> }) {
	return (
		<div className="flex size-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
			{loaded.state === "loading" ? <Spinner className="size-4" /> : <p role="alert">Could not load this version. {loaded.error}</p>}
		</div>
	);
}

/**
 * The version behind `link`, rendered, or its source when `source` is set.
 * Every kind waits for the version's text, so a missing copy says so instead of framing the route's JSON 404.
 */
export function ArtifactView({ link, kind, title, source }: { link: Loaded<string>; kind: ArtifactKind; title: string; source: boolean }) {
	const text = useArtifactText(link.state === "ready" ? link.value : null);
	if (link.state !== "ready") return <Waiting loaded={link} />;
	if (text.state !== "ready") return <Waiting loaded={text} />;
	if (source) return <SourceText text={text.value} kind={kind} />;
	const { Rendered } = ARTIFACT_KIND[kind];
	return <Rendered url={link.value} text={text.value} title={title} />;
}
