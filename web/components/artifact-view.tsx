/** `ArtifactView`: one artifact version drawn as its kind draws, or as its source; and the kind table the card and the Artifacts tab share. */
import { IconCode, IconFileText, IconImages1 } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type ReactNode, useEffect, useRef } from "react";
import { type ArtifactKind, parseArtifactImages } from "../../src/shared/artifacts";
import { activityControl } from "../activity";
import type { Loaded } from "../artifact-links";
import { CodeText } from "./file-text";
import { useImageList } from "./markdown-images";
import { MessageMarkdown, SESSION_AGENT_PRESET } from "./message-markdown";
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
 * `&frame=1` adds the server's image bridge, whose message about a clicked inline image opens the page's images large.
 */
function HtmlFrame({ url, title }: RenderedProps) {
	const frame = useRef<HTMLIFrameElement>(null);
	const { show, viewer } = useImageList();
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frame.current?.contentWindow) return;
			const clicked = parseArtifactImages(event.data);
			if (clicked) show(clicked.images, clicked.index);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [show]);
	return (
		<>
			<iframe
				ref={frame}
				key={url}
				src={`${url}&frame=1`}
				title={title}
				sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
				referrerPolicy="no-referrer"
				className="size-full border-0 bg-white"
			/>
			{viewer}
		</>
	);
}

function SvgImage({ url, title }: RenderedProps) {
	const { show, viewer } = useImageList();
	return (
		<div className="flex size-full items-center justify-center overflow-auto bg-muted/40 p-6">
			<button {...activityControl("media-viewer.open")} type="button" aria-label={`Open ${title}`} onClick={() => show([{ src: url, caption: title }], 0)} className="size-full cursor-zoom-in rounded-md">
				<img src={url} alt={title} className="size-full object-contain" />
			</button>
			{viewer}
		</div>
	);
}

/** A document page: a reading column centred in the panel, with the page's own margins. */
function MarkdownText({ text }: RenderedProps) {
	return (
		<div className="size-full overflow-auto">
			<article className="artifact-document mx-auto max-w-[48rem] px-10 py-9 @max-[30rem]/artifacts:px-5 @max-[30rem]/artifacts:py-6">
				<MessageMarkdown text={text} preset={SESSION_AGENT_PRESET} />
			</article>
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
