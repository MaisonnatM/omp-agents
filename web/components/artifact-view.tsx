/** `ArtifactView`: one artifact version drawn as its kind draws, or as its source; and the kind table the card and the Artifacts tab share. */
import { IconCode, IconFileText, IconImages1 } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import type { ReactNode } from "react";
import type { ArtifactKind } from "../../src/shared/artifacts";
import type { Loaded } from "../artifact-links";
import { CodeText } from "./file-text";
import { MessageMarkdown } from "./message-markdown";
import { LoadNote } from "./sheet-details";

interface RenderedProps {
	url: string;
	text: string;
	title: string;
}

/** Each kind's name, icon, and how it draws. */
export const ARTIFACT_KIND: Record<ArtifactKind, { label: string; icon: IconComponent; Rendered: (props: RenderedProps) => ReactNode }> = {
	html: { label: "HTML", icon: IconCode, Rendered: HtmlFrame },
	markdown: { label: "Markdown", icon: IconFileText, Rendered: MarkdownText },
	svg: { label: "SVG", icon: IconImages1, Rendered: SvgImage },
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

/** The reading line while the version loads, or why it could not. */
function Waiting({ failure }: { failure: string | null }) {
	return (
		<div className="flex size-full items-center justify-center p-4 text-center">
			<LoadNote loading="Reading the version…" error={failure} />
		</div>
	);
}

/** The version `loaded` holds, rendered, or its source when `source` is set; while it loads, or once it failed, the reading line. */
export function ArtifactView({ loaded, kind, file, title, source }: { loaded: Loaded<{ url: string; text: string }>; kind: ArtifactKind; file: string; title: string; source: boolean }) {
	if (loaded.state !== "ready") return <Waiting failure={loaded.state === "failed" ? loaded.error : null} />;
	const { url, text } = loaded.value;
	if (source) return <CodeText text={text} path={file} className="h-full rounded-none border-0" />;
	const { Rendered } = ARTIFACT_KIND[kind];
	return <Rendered url={url} text={text} title={title} />;
}
