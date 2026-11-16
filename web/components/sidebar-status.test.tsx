import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage } from "../../src/shared/models";
import type { SystemLoad } from "../../src/shared/system";
import { MachineLoad } from "./machine-stats";
import { SidebarFoot } from "./sidebar-status";

const GB = 1024 ** 3;
const load: SystemLoad = { cpuPercent: 12, memoryAvailable: 8 * GB, memoryTotal: 16 * GB, diskAvailable: 100 * GB, diskTotal: 500 * GB };
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

test("the machine's stats name CPU, free memory, and free disk", () => {
	const markup = markupOf(<MachineLoad load={load} titles={new Map()} />);
	expect(markup).toContain('aria-label="CPU: 12% busy"');
	expect(markup).toContain("Memory free: 8.0 GB of 16 GB");
	expect(markup).toContain("Disk free: 100 GB of 500 GB");
});
