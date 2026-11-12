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
