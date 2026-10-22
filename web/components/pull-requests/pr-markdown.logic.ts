/** The rehype pass that makes a pull request's Markdown read as GitHub's: autolinks, alerts, and uploads standing alone in a paragraph. */
import type { Element, ElementContent, Root } from "hast";
import { githubMediaUrl } from "../../../src/shared/github";

const AUTOLINK = /#[1-9]\d*|[0-9a-f]{40}/giu;
const WORD = /[A-Za-z0-9_]/u;
const COMMIT_PREFIX = /[\s([{]/u;
const SKIP_AUTOLINKS: Record<string, true> = { a: true, code: true, pre: true };
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|svg)$/iu;
const VIDEO_EXTENSION = /\.(?:mp4|webm|mov|m4v|ogv)$/iu;

/** `text` with its `#42` references and full commit hashes linked into `base`, or `null` when it has none. */
function autolinks(text: string, base: string): ElementContent[] | null {
	const result: ElementContent[] = [];
	let at = 0;
	for (const match of text.matchAll(AUTOLINK)) {
		const value = match[0];
		const reference = value.startsWith("#");
		const before = text[match.index - 1];
		const after = text[match.index + value.length];
		if ((before !== undefined && (reference ? WORD.test(before) : !COMMIT_PREFIX.test(before))) || (after !== undefined && WORD.test(after))) continue;
		if (match.index > at) result.push({ type: "text", value: text.slice(at, match.index) });
		const href = `${base}/${reference ? `issues/${value.slice(1)}` : `commit/${value}`}`;
		result.push({ type: "element", tagName: "a", properties: { href }, children: [{ type: "text", value: reference ? value : value.slice(0, 7) }] });
		at = match.index + value.length;
	}
	if (at === 0) return null;
	if (at < text.length) result.push({ type: "text", value: text.slice(at) });
	return result;
}

export type GitHubAlert = "note" | "tip" | "important" | "warning" | "caution";

export function parseGitHubAlert(text: string, hasFollowingContent = false): { type: GitHubAlert; body: string } | null {
	const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/i.exec(text);
	if (!match || (!match[0].endsWith("\n") && hasFollowingContent)) return null;
	return { type: match[1]!.toLowerCase() as GitHubAlert, body: text.slice(match[0].length) };
}

/** Marks a blockquote that opens with a GitHub alert's `[!TYPE]` line with `data-alert`, dropping the line. */
function markAlert(node: Element): void {
	const paragraph = node.children.find(child => child.type !== "text" || child.value.trim() !== "");
	if (paragraph?.type !== "element" || paragraph.tagName !== "p") return;
	const text = paragraph.children[0];
	if (text?.type !== "text") return;
	const alert = parseGitHubAlert(text.value, paragraph.children.length > 1);
	if (!alert) return;
	if (alert.body) text.value = alert.body;
	else paragraph.children.shift();
	if (paragraph.children.length === 0) node.children.splice(node.children.indexOf(paragraph), 1);
	node.properties.dataAlert = alert.type;
}

/**
 * A paragraph that holds only a link to a file uploaded to GitHub, as GitHub writes an upload into the text, shown as
 * GitHub shows it: a video plays, an image shows, and any other file is a `figure` whose `data-attachment` names it.
 */
function attachment(node: Element): Element | null {
	const content = node.children.filter(child => child.type !== "text" || child.value.trim() !== "");
	const link = content[0];
	if (content.length !== 1 || link?.type !== "element" || link.tagName !== "a" || typeof link.properties.href !== "string") return null;
	const src = link.properties.href;
	const url = githubMediaUrl(src);
	if (!url) return null;
	if (VIDEO_EXTENSION.test(url.pathname) || /^\/user-attachments\/assets\/[\w-]+$/u.test(url.pathname)) return { type: "element", tagName: "video", properties: { src }, children: [] };
	if (IMAGE_EXTENSION.test(url.pathname)) return { ...node, children: [{ type: "element", tagName: "img", properties: { src, alt: "" }, children: [] }] };
	return { type: "element", tagName: "figure", properties: { dataAttachment: src }, children: [] };
}

/**
 * GitHub's rendering of a pull request's text over the sanitized tree, so its raw HTML counts as Markdown does: alerts,
 * uploads on a line of their own, and `#42` and full commit hashes linked into `repositoryUrl` outside links and code.
 */
export function rehypePullRequestMarkdown({ repositoryUrl }: { repositoryUrl: string }) {
	const base = repositoryUrl.replace(/\/+$/u, "");
	return function visit(parent: Root | Element): void {
		for (let index = 0; index < parent.children.length; index++) {
			const node = parent.children[index]!;
			if (node.type === "text") {
				const links = autolinks(node.value, base);
				if (links) {
					parent.children.splice(index, 1, ...links);
					index += links.length - 1;
				}
			} else if (node.type === "element") {
				const upload = node.tagName === "p" ? attachment(node) : null;
				if (upload) {
					parent.children[index] = upload;
					continue;
				}
				if (node.tagName === "blockquote") markAlert(node);
				if (!SKIP_AUTOLINKS[node.tagName]) visit(node);
			}
		}
	};
}
