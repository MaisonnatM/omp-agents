/**
 * The references a prompt carries as text, which the composer and the transcript show as chips: what the `/` completion
 * and the `@` menu insert. The prompt stays a string; a chip is a view of the characters it covers.
 */
import { skillLabel } from "./labels";

export type ChipKind = "skill" | "command" | "file" | "directory" | "ticket" | "pull-request" | "todo" | "session";

export interface PromptToken {
	kind: ChipKind;
	/** What the chip reads. */
	label: string;
	/** Where it points: a file or directory path, a link, a skill or command name, or a todo or session id. */
	target: string;
	start: number;
	end: number;
}

/** A string in the form `JSON.stringify` writes, read back; one the user edited by hand reads as written. */
const quoted = (json: string): string => {
	try {
		return JSON.parse(json);
	} catch {
		return json.slice(1, -1);
	}
};

const unescapeLink = (text: string): string => text.replace(/\\([[\]])/g, "$1");

const STRING = String.raw`"(?:[^"\\\n]|\\.)*"`;

interface Pattern {
	re: RegExp;
	/** Only at the very start of the prompt, as omp reads a command. */
	leading?: true;
	token: (match: RegExpExecArray) => Omit<PromptToken, "start" | "end">;
}

const PATTERNS: readonly Pattern[] = [
	{ re: /^\/skill:(\S+)(?=\s|$)/g, leading: true, token: m => ({ kind: "skill", label: skillLabel(m[1]), target: m[1] }) },
	{ re: /^\/([a-z][\w-]*)(?=\s|$)/g, leading: true, token: m => ({ kind: "command", label: `/${m[1]}`, target: m[1] }) },
	{
		re: /\[([A-Z][A-Z\d]*-\d+ (?:[^\]\\\n]|\\.)*)\]\((https:\/\/linear\.app\/[^)\s]+)\)/g,
		token: m => ({ kind: "ticket", label: unescapeLink(m[1]), target: m[2] }),
	},
	{
		re: /\[([\w.-]+\/[\w.-]+#\d+ (?:[^\]\\\n]|\\.)*)\]\((https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)\)/g,
		token: m => ({ kind: "pull-request", label: unescapeLink(m[1]), target: m[2] }),
	},
	{ re: new RegExp(String.raw`(?<![\w-])todo (${STRING}) \(id ([\w-]+)\)`, "g"), token: m => ({ kind: "todo", label: quoted(m[1]), target: m[2] }) },
	{ re: new RegExp(String.raw`(?<![\w-])omp session (${STRING}) \(id ([\w-]+)\)`, "g"), token: m => ({ kind: "session", label: quoted(m[1]), target: m[2] }) },
	{
		// The `@` menu's category prefixes are a query still being typed, not a path.
		re: /(?<=^|\s)@(?!(?:file|todo|ticket|pr|session):)("[^"\n]+"|[^\s"]+)(?=\s|$)/g,
		token: m => {
			const path = m[1].replace(/^"(.*)"$/, "$1");
			const directory = path.endsWith("/");
			const name = path.replace(/\/$/, "").split("/").pop() || path;
			return { kind: directory ? "directory" : "file", label: directory ? `${name}/` : name, target: path };
		},
	},
];

/**
 * The references in `text`, left to right and never overlapping. `open` is the caret while the user types: a reference
 * ending there may still be written, as `/mo` on the way to `/move`, so it stays text. `leading` says `text` starts the
 * prompt, where a command or skill may sit.
 */
export function promptTokens(text: string, { open = null, leading = true }: { open?: number | null; leading?: boolean } = {}): PromptToken[] {
	const found: PromptToken[] = [];
	for (const pattern of PATTERNS) {
		if (pattern.leading && !leading) continue;
		pattern.re.lastIndex = 0;
		for (let match = pattern.re.exec(text); match; match = pattern.re.exec(text)) {
			const end = match.index + match[0].length;
			if (end !== open) found.push({ ...pattern.token(match), start: match.index, end });
		}
	}
	found.sort((a, b) => a.start - b.start || b.end - a.end);
	const tokens: PromptToken[] = [];
	for (const token of found) if (tokens.length === 0 || token.start >= tokens[tokens.length - 1].end) tokens.push(token);
	return tokens;
}

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	position?: { start: { offset?: number }; end: { offset?: number } };
	data?: { hName: string; hProperties: Record<string, string> };
}

/** A chip as markdown: a `span` that `MessageMarkdown` draws as `PromptChip`; it has no children, so later plugins leave it alone. */
const chipNode = ({ kind, label, target }: PromptToken): MdNode => ({
	type: "promptChip",
	data: { hName: "span", hProperties: { dataChip: kind, dataLabel: label, dataTarget: target } },
});

function chipText(node: MdNode): MdNode[] {
	const text = node.value ?? "";
	const nodes: MdNode[] = [];
	let at = 0;
	for (const token of promptTokens(text, { leading: node.position?.start.offset === 0 })) {
		if (token.start > at) nodes.push({ type: "text", value: text.slice(at, token.start) });
		nodes.push(chipNode(token));
		at = token.end;
	}
	if (at < text.length) nodes.push({ type: "text", value: text.slice(at) });
	return nodes;
}

function chipTree(parent: MdNode, source: string): void {
	if (!parent.children) return;
	parent.children = parent.children.flatMap(node => {
		if (node.type === "text") return chipText(node);
		if (node.type === "link") {
			// A ticket or pull request is a markdown link, which the parser has already taken apart: match its source.
			const written = source.slice(node.position?.start.offset, node.position?.end.offset);
			const [token] = promptTokens(written, { leading: false });
			return token && token.start === 0 && token.end === written.length ? [chipNode(token)] : [node];
		}
		chipTree(node, source);
		return [node];
	});
}

/** A remark plugin that makes each reference in a sent prompt a chip, as the composer showed it. */
export const remarkPromptChips = () => (tree: MdNode, file: { value: unknown }) => chipTree(tree, String(file.value));
