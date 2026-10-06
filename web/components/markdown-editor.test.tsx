import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownEditor } from "./markdown-editor";

test("editable notes show only their render until you open the editor", () => {
	const html = renderToStaticMarkup(<MarkdownEditor value={"# Note\n\n**bold**"} label="Notes of Ship" readOnly={false} onSave={() => {}} />);
	expect(html).toContain("<h1>Note</h1>");
	expect(html).toContain("<strong>bold</strong>");
	expect(html).toContain('aria-label="Edit Notes of Ship"');
	expect(html).not.toContain("<textarea");
	expect(html).not.toContain("**bold**");
});

test("read-only notes are only the render, with no way into the editor", () => {
	const html = renderToStaticMarkup(<MarkdownEditor value={"# Note"} label="Notes of Ship" readOnly onSave={() => {}} />);
	expect(html).toContain("<h1>Note</h1>");
	expect(html).not.toContain("<textarea");
	expect(html).not.toContain('role="button"');
});

test("empty editable notes offer to add some", () => {
	const html = renderToStaticMarkup(<MarkdownEditor value="   " label="Notes of Ship" readOnly={false} onSave={() => {}} />);
	expect(html).toContain("Add notes…");
	expect(html).toContain('role="button"');
});
