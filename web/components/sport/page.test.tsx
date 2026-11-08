import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { STATE } from "../../../src/sport-fixtures";
import { SportPage } from "./page";
import { ProgressTab } from "./progress";

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

test("the max's chart says what is left to the target and when the next test falls, one period after each short date", () => {
	const html = renderToStaticMarkup(<ProgressTab state={STATE} today="2026-11-07" />);
	expect(html).toContain("112 kg");
	expect(html).toContain("Il te reste 7 kg pour atteindre 119 kg d&#x27;ici le 7 févr. Prochain test le 29 déc.</p>");
});
