import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UserRequest } from "../../src/shared/sessions";
import { UserRequestCard } from "./user-request";

type AskQuestion = Extract<UserRequest, { kind: "ask" }>["questions"][number];

const option = (label: string) => ({ label, description: null });
const name: AskQuestion = { id: "name", question: "Project name?", header: null, options: [], multi: false, recommended: null };
const langs: AskQuestion = { id: "langs", question: "Which languages?", header: "Stack", options: [option("TS"), option("Go"), option("Rust")], multi: true, recommended: null };
const db: AskQuestion = { id: "db", question: "Database?", header: null, options: [option("SQLite"), option("Postgres")], multi: false, recommended: 1 };

const render = (questions: AskQuestion[]) =>
	renderToStaticMarkup(
		<UserRequestCard request={{ id: "r1", title: questions[0]!.question, deadline: null, kind: "ask", questions }} queued={0} onAnswer={async () => {}} shortcuts={false} />,
	);

test("a whole ask form is one card that starts at its first question and counts the rest", () => {
	const html = render([langs, db, name]);
	expect(html.match(/<h3/g)).toHaveLength(1);
	expect(html).toContain("Stack · Question 1 of 3 · Waiting for your answer");
	expect(html).toContain("Which languages?");
	expect(html).not.toContain("Database?");
});

test("a multi-select question shows its rows, an Other row, and a Next button that moves on", () => {
	const html = render([langs, db, name]);
	for (const label of ["TS", "Go", "Rust", "Other"]) expect(html).toContain(`>${label}<`);
	expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*>Next<(?:(?!<\/button>)[\s\S])*<\/button>/);
	expect(html).not.toContain("<textarea");
});

test("a free-text question of the form shows a text field it can send blank, with Send when last", () => {
	const first = render([name, langs]);
	expect(first).toContain("<textarea");
	expect(first).toContain("Project name?");
	expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Next/);
	expect(first).not.toContain(">Other<");

	const only = render([name]);
	expect(only).toContain("Send");
	expect(only).not.toContain("Question 1 of");
});

const renderStep = (request: UserRequest) => renderToStaticMarkup(<UserRequestCard request={request} queued={0} onAnswer={async () => {}} shortcuts={false} />);

test("a confirm is an approval card with No and Yes buttons and the keys that answer them", () => {
	const html = renderStep({ id: "c", title: "Remove worktree?", deadline: null, kind: "confirm", message: "Line one\n\nLine two" });
	expect(html).toContain("Remove worktree?");
	expect(html).toContain("Line one\n\nLine two");
	expect(html).toMatch(/>No<kbd[^>]*>2<\/kbd>/);
	expect(html).toMatch(/>Yes<kbd[^>]*>1<\/kbd>/);
	expect(html).not.toContain('role="radio"');
});

test("omp's tool approval names the tool, its reason and details, and offers Deny then each allow choice as a button, Allow once primary", () => {
	const html = renderStep({
		id: "a",
		title: "Allow tool: bash\nReason: outside the workspace\nCommand: rm -rf dist",
		deadline: null,
		kind: "select",
		checkboxes: 0,
		checked: [],
		options: [option("Approve"), option("Approve bash for this session"), option("Deny")],
	});
	expect(html).toContain("Allow bash?</h3>");
	expect(html).toContain("outside the workspace</div>");
	expect(html).toContain("Command: rm -rf dist</pre>");
	expect(html).toMatch(/>Deny<kbd[^>]*>3<\/kbd>/);
	expect(html).toMatch(/>Allow for session<kbd[^>]*>2<\/kbd>/);
	expect(html).toMatch(/>Allow once<kbd[^>]*>1<\/kbd>/);
});

test("a select that is not a tool approval stays a question", () => {
	const html = renderStep({ id: "s", title: "Allow tool: bash", deadline: null, kind: "select", checkboxes: 0, checked: [], options: [option("Yes"), option("No")] });
	expect(html).not.toContain("Allow bash?");
	expect(html).toContain('role="radio"');
});

test("an ask multi-select sent step by step ticks its checked rows and turns Done selecting into a button", () => {
	const html = renderStep({
		id: "m",
		title: "(1 selected) Scope",
		deadline: null,
		kind: "select",
		checkboxes: 3,
		checked: [1],
		options: [option("Combobox"), option("Color Picker"), option("Other (type your own)"), option("✓ Done selecting")],
	});
	expect(html).toContain(">Scope</h3>");
	expect(html.match(/role="checkbox"/g)).toHaveLength(3);
	expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
	expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*>Done selecting<(?:(?!<\/button>)[\s\S])*<\/button>/);
});
