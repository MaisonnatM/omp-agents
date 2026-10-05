import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownEditor } from "./markdown-editor";

test("notes stay rendered while they can be edited, with no write or preview mode", () => {
	const html = renderToStaticMarkup(<MarkdownEditor value={"# Note\n\n**bold**"} label="Notes of Ship" readOnly={false} onSave={() => {}} />);
	expect(html).toContain("<h1>Note</h1>");
	expect(html).toContain("<strong>bold</strong>");
	expect(html).toContain("<textarea");
	expect(html).toContain("# Note");
	expect(html).toContain("**bold**");
	expect(html).not.toContain(">Write<");
	expect(html).not.toContain(">Preview<");
});

test("read-only notes are only the render", () => {
	const html = renderToStaticMarkup(<MarkdownEditor value={"# Note"} label="Notes of Ship" readOnly onSave={() => {}} />);
	expect(html).toContain("<h1>Note</h1>");
	expect(html).not.toContain("<textarea");
	expect(html).not.toContain(">Write<");
	expect(html).not.toContain(">Preview<");
});

test("an empty note still shows the preview", () => {
	const html = renderToStaticMarkup(<MarkdownEditor value="   " label="Notes of Ship" readOnly={false} onSave={() => {}} />);
	expect(html).toContain("Nothing to preview.");
	expect(html).toContain('placeholder="Write notes in markdown…"');
	expect(html).toContain("<textarea");
});
