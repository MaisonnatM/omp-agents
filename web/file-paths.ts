/**
 * The paths of files in agent text, which open in the page's file dialog: `GET /api/file` reads the text files whose
 * extension `TEXT_FILE_EXTENSIONS` lists, and `GET /api/media` serves the images and videos `MEDIA_FILE_TYPES` lists.
 */
import { isVideoExtension, MEDIA_FILE_EXTENSIONS, TEXT_FILE_EXTENSIONS } from "../src/shared/transcript";

const EXTENSIONS = [...TEXT_FILE_EXTENSIONS, ...MEDIA_FILE_EXTENSIONS].join("|");
const SEGMENTS = String.raw`[\w.@+~-]+(?:\/[\w.@+~-]+)*\.(?:${EXTENSIONS})`;
const LINE = String.raw`(?::\d+(?:-\d+)?)?`;
/** A path in prose: absolute or `~/` only, since a relative one would match words such as `and/or.txt`. */
const PROSE_PATH = new RegExp(String.raw`(?<![\w~./:-])(?:~\/|\/)${SEGMENTS}${LINE}(?![\w/])`, "gi");
/** An inline code span that is a path, relative ones included: `` `docs/usage.md:12` ``. */
const CODE_PATH = new RegExp(String.raw`^(?:~\/|\.{0,2}\/)?${SEGMENTS}${LINE}$`, "i");
const LINKED_FILE = new RegExp(String.raw`\.(${EXTENSIONS})$`, "i");
const LINE_SUFFIX = /:\d+(?:-\d+)?$/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** What a file in agent text is: a text file the dialog reads, or an image or video it shows. */
export type FileKind = "text" | "image" | "video";

/** The file a link's `href` names, without a `:line` suffix, or `null` for a web address or any other file. */
export function linkedFile(href: string): { path: string; kind: FileKind } | null {
	if (href === "" || SCHEME.test(href) || href.startsWith("#") || href.startsWith("?")) return null;
	const path = href.replace(LINE_SUFFIX, "");
	const extension = LINKED_FILE.exec(path)?.[1]?.toLowerCase();
	if (extension === undefined) return null;
	return { path, kind: TEXT_FILE_EXTENSIONS.includes(extension) ? "text" : isVideoExtension(extension) ? "video" : "image" };
}

/** Whether `path` is absolute or `~/`, as the transcript writes a path outside the session's directory. */
export function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || path.startsWith("~/");
}

/**
 * The path the server reads for `path`: as it is when absolute or `~/`, else resolved against `base`, the session's
 * directory or the open file's; `null` without one.
 */
export function absoluteFilePath(path: string, base: string | null): string | null {
	if (isAbsolutePath(path)) return path;
	if (base === null) return null;
	const segments: string[] = [];
	for (const segment of `${base}/${path}`.split("/")) {
		if (segment === "..") segments.pop();
		else if (segment !== "" && segment !== ".") segments.push(segment);
	}
	return `/${segments.join("/")}`;
}

interface MdNode {
	type: string;
	value?: string;
	url?: string;
	children?: MdNode[];
	data?: { hName: string; hProperties: Record<string, string> };
}

/** `text` with each prose path in it made a link. */
function linkProse(text: string): MdNode[] {
	const nodes: MdNode[] = [];
	let at = 0;
	for (const match of text.matchAll(PROSE_PATH)) {
		if (match.index > at) nodes.push({ type: "text", value: text.slice(at, match.index) });
		nodes.push({ type: "link", url: match[0], children: [{ type: "text", value: match[0] }] });
		at = match.index + match[0].length;
	}
	if (at < text.length) nodes.push({ type: "text", value: text.slice(at) });
	return nodes;
}

function linkPaths(parent: MdNode): void {
	if (!parent.children || parent.type === "link" || parent.type === "linkReference") return;
	parent.children = parent.children.flatMap(node => {
		if (node.type === "inlineCode" && CODE_PATH.test(node.value?.trim() ?? "")) return [{ type: "link", url: node.value!.trim(), children: [node] }];
		if (node.type === "text" && node.value) return linkProse(node.value);
		linkPaths(node);
		return [node];
	});
}

/**
 * A remark plugin that makes each file path in agent text a link, which `MessageMarkdown` opens in the file dialog, and
 * ends the text with a `figure` of the images and videos it names, in order and each once, but for those an image
 * already shows, so the message shows them as well as naming them.
 */
export const remarkFilePaths = () => (root: MdNode) => {
	linkPaths(root);
	const shown = new Set<string>();
	const named: string[] = [];
	const visit = (node: MdNode): void => {
		if (node.type === "image" && node.url) shown.add(node.url);
		if (node.type === "link" && node.url) {
			const file = linkedFile(node.url);
			if (file && file.kind !== "text") named.push(file.path);
		}
		node.children?.forEach(visit);
	};
	visit(root);
	const media = [...new Set(named)].filter(path => !shown.has(path));
	if (media.length > 0) root.children?.push({ type: "mediaStrip", children: [], data: { hName: "figure", hProperties: { dataMedia: JSON.stringify(media) } } });
};
