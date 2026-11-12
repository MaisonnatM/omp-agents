/** `ArtifactView`: one artifact version drawn as its kind draws, or as its source; and the kind table the card and the Artifacts tab share. */
import { FileCode2, FileText, Image, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ArtifactKind } from "../../src/shared/artifacts";
import { type Loaded, useArtifactText } from "../artifact-links";
import { CodeText } from "./file-text";
import { MessageMarkdown } from "./message-markdown";
import { Spinner } from "./spinner";

interface RenderedProps {
	url: string;
	text: string;
	title: string;
}

/** Each kind's name, icon, and how it draws. */
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

/** A spinner while the version loads, or why it could not. */
function Waiting({ failure }: { failure: string | null }) {
	return (
		<div className="flex size-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
			{failure === null ? <Spinner className="size-4" /> : <p role="alert">{failure}</p>}
		</div>
	);
}

/**
 * The version behind `link`, rendered, or its source when `source` is set.
 * Every kind waits for the version's text, so a missing copy says so instead of framing the route's JSON 404.
 */
export function ArtifactView({ link, kind, file, title, source }: { link: Loaded<string>; kind: ArtifactKind; file: string; title: string; source: boolean }) {
	const text = useArtifactText(link.state === "ready" ? link.value : null);
	// The text's failures are whole sentences already; the link's are the server's words.
	const failure = link.state === "failed" ? `Could not load this version. ${link.error}` : text.state === "failed" ? text.error : null;
	if (link.state !== "ready" || text.state !== "ready") return <Waiting failure={failure} />;
	if (source) return <CodeText text={text.value} path={file} className="h-full rounded-none border-0" />;
	const { Rendered } = ARTIFACT_KIND[kind];
	return <Rendered url={link.value} text={text.value} title={title} />;
}
