import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { STATE } from "../../../src/sport-fixtures";
import { SportPage } from "./page";

const render = (state: typeof STATE | null, day: string | null = null): string => renderToStaticMarkup(<SportPage state={state} route={{ tab: "week", day }} disabled={false} onChange={async () => {}} />);

test("with no plan, the week says what to ask the agent", () => {
	const html = render({ ...STATE, plan: null });
	expect(html).toContain("Pas encore de plan");
	expect(html).toContain("Crée-moi un plan d&#x27;escalade");
});

test("Tuesday 17 November calls for +15 kg on the semi-crimp", () => {
	const html = render(STATE, "2026-11-17");
	expect(html).toContain("Semi-arquée et bloc max");
	expect(html).toContain("+15 kg");
	expect(html).toContain("transition · semaine 1 sur 3");
});
