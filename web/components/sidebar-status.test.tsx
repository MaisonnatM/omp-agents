import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage } from "../../src/shared/models";
import type { SystemLoad } from "../../src/shared/system";
import { SidebarFoot } from "./sidebar-status";

const GB = 1024 ** 3;
const load: SystemLoad = { cpuPercent: 12, memoryAvailable: 8 * GB, memoryTotal: 16 * GB, diskAvailable: 100 * GB, diskTotal: 500 * GB };
const apiCredits: PlanUsage = { provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null };
const foot = (props: Parameters<typeof SidebarFoot>[0]) => renderToStaticMarkup(<SidebarFoot {...props} />).replaceAll("<!-- -->", "");

test("the machine's tiles still show when plan usage cannot be read, under the reason", () => {
	const markup = foot({ usage: { plans: [apiCredits], error: "omp not found" }, load, titles: new Map() });
	expect(markup).toContain("Cannot read plan usage: omp not found");
	expect(markup).toContain('aria-label="CPU: 12% busy"');
	expect(markup).toContain("Memory free");
	expect(markup).toContain("Disk free");
	expect(markup).not.toContain("API credits");
});

test("with no plan tiles and the machine's load not read yet, the foot shows its note and no empty grid", () => {
	const markup = foot({ usage: null, load: null, titles: new Map() });
	expect(markup).toContain("Checking plans…");
	expect(markup).not.toContain("<ul");
});
