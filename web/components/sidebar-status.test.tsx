import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage } from "../../src/shared/models";
import { SidebarFoot } from "./sidebar-status";

const apiCredits: PlanUsage = { provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null };
const markupOf = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node).replaceAll("<!-- -->", "");

test("the foot names why plan usage cannot be read and draws no plan rows", () => {
	const markup = markupOf(<SidebarFoot usage={{ plans: [apiCredits], error: "omp not found" }} />);
	expect(markup).toContain("Cannot read plan usage: omp not found");
	expect(markup).not.toContain("API credits");
	expect(markup).not.toContain("<ul");
});

test("with plan usage not read yet, the foot shows its note and no empty list", () => {
	const markup = markupOf(<SidebarFoot usage={null} />);
	expect(markup).toContain("Checking plans…");
	expect(markup).not.toContain("<ul");
});
