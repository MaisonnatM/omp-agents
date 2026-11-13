import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type Question, QuestionCard } from "./question-card";

const text = (overrides: Partial<Extract<Question, { kind: "text" }>> = {}): Question => ({
	kind: "text",
	title: "Project name?",
	field: "line",
	submitLabel: "Next",
	...overrides,
});

const render = (question: Question, defaultText?: string) =>
	renderToStaticMarkup(<QuestionCard question={question} checked={[]} defaultText={defaultText} header="Header" onAnswer={() => {}} />);

test("a free-text question shows a text field labelled by its title, with its placeholder and submit label", () => {
	const html = render(text({ placeholder: "my-app" }));
	expect(html).toContain("<textarea");
	expect(html).toContain('placeholder="my-app"');
	expect(html).toMatch(/<h3 id="([^"]+)"[^>]*>Project name\?<\/h3>[\s\S]*aria-labelledby="\1"/);
	expect(html).toContain("Next");
});

test("a free-text question cannot be sent blank unless it allows an empty answer", () => {
	expect(render(text())).toMatch(/<button[^>]*disabled=""/);
	expect(render(text({ allowEmpty: true }))).not.toMatch(/<button[^>]*disabled=""/);
	expect(render(text(), "acme")).not.toMatch(/<button[^>]*disabled=""/);
});

test("a free-text question starts with the text typed before", () => {
	expect(render(text(), "acme")).toMatch(/<textarea[^>]*>acme<\/textarea>/);
});

test("a secret field is a password input the browser does not fill", () => {
	const html = render(text({ field: "secret" }));
	expect(html).toMatch(/autocomplete="off"/i);
	expect(html).not.toContain("<textarea");
});
