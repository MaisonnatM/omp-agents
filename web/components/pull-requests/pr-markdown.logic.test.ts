import { expect, test } from "bun:test";
import type { Element, ElementContent, Root } from "hast";
import { parseGitHubAlert, rehypePullRequestMarkdown, type GitHubAlert } from "./pr-markdown.logic";

const sha = "0123456789abcdef0123456789abcdef01234567";

const text = (value: string) => ({ type: "text" as const, value });
const element = (tagName: string, children: ElementContent[], properties: Element["properties"] = {}): Element => ({ type: "element", tagName, properties, children });
const linked = (repositoryUrl: string, children: ElementContent[]): ElementContent[] => {
	const tree: Root = { type: "root", children };
	rehypePullRequestMarkdown({ repositoryUrl })(tree);
	return tree.children as ElementContent[];
};

test("PR autolinks preserve issue numbers and shorten full commit hashes", () => {
	expect(linked("https://github.com/acme/app/", [element("p", [text(`Fix #42 (${sha})`)])])).toEqual([element("p", [
		text("Fix "),
		element("a", [text("#42")], { href: "https://github.com/acme/app/issues/42" }),
		text(" ("),
		element("a", [text("0123456")], { href: "https://github.com/acme/app/commit/0123456789abcdef0123456789abcdef01234567" }),
		text(")"),
	])]);
});

test("PR autolinks reject word fragments, zero references and non-delimited hashes", () => {
	const value = `word#42 #0 #01 #42suffix a${sha} /${sha} ${sha}a`;
	expect(linked("https://github.com/acme/app", [element("p", [text(value)])])).toEqual([element("p", [text(value)])]);
});

test("PR autolinks skip text anywhere inside links, code and preformatted blocks", () => {
	const tree = [
		element("a", [element("b", [text("#42")])], { href: "https://example.com" }),
		element("p", [element("code", [text(`#42 ${sha}`)])]),
		element("pre", [element("span", [text("#42")])]),
	];
	expect(linked("https://github.com/acme/app", structuredClone(tree))).toEqual(tree);
});

test("PR alerts mark the blockquote and drop the marker line", () => {
	expect(linked("https://github.com/acme/app", [element("blockquote", [text("\n"), element("p", [text("[!TIP]\nSee #7")])])])).toEqual([
		element("blockquote", [text("\n"), element("p", [text("See "), element("a", [text("#7")], { href: "https://github.com/acme/app/issues/7" })])], { dataAlert: "tip" }),
	]);
});

test("GitHub alerts recognize all five markers only on their own first line", () => {
	const types: GitHubAlert[] = ["note", "tip", "important", "warning", "caution"];
	for (const type of types) {
		expect(parseGitHubAlert(`[!${type.toUpperCase()}]\nRead **this**`)).toEqual({ type, body: "Read **this**" });
	}
	expect(parseGitHubAlert("[!NOTE]\r\nBody")).toEqual({ type: "note", body: "Body" });
	expect(parseGitHubAlert("[!NOTE]")).toEqual({ type: "note", body: "" });
	expect(parseGitHubAlert("[!NOTE]\n", true)).toEqual({ type: "note", body: "" });
	expect(parseGitHubAlert("[!NOTE]", true)).toBeNull();
	for (const text of ["[!UNKNOWN]\nBody", "[!NOTE] inline", "Before [!NOTE]\nBody", " [!NOTE]\nBody"]) expect(parseGitHubAlert(text)).toBeNull();
});

test("PR uploads on a line of their own play, show, or card as GitHub shows them", () => {
	const upload = (href: string, label = href) => element("p", [text("\n"), element("a", [text(label)], { href })]);
	expect(linked("https://github.com/acme/app", [
		upload("https://github.com/user-attachments/assets/abc-1"),
		upload("https://user-images.githubusercontent.com/1/demo.mp4", "Demo"),
		upload("https://private-user-images.githubusercontent.com/1/shot.png?jwt=a"),
		upload("https://github.com/user-attachments/files/42/report.pdf"),
	])).toEqual([
		element("video", [], { src: "https://github.com/user-attachments/assets/abc-1" }),
		element("video", [], { src: "https://user-images.githubusercontent.com/1/demo.mp4" }),
		element("p", [element("img", [], { src: "https://private-user-images.githubusercontent.com/1/shot.png?jwt=a", alt: "" })]),
		element("figure", [], { dataAttachment: "https://github.com/user-attachments/files/42/report.pdf" }),
	]);
});

test("PR links that share their paragraph or leave GitHub stay links", () => {
	const tree = [
		element("p", [text("See "), element("a", [text("upload")], { href: "https://github.com/user-attachments/assets/abc" })]),
		element("p", [element("a", [text("https://example.com/a.mp4")], { href: "https://example.com/a.mp4" })]),
	];
	expect(linked("https://github.com/acme/app", structuredClone(tree))).toEqual(tree);
});
