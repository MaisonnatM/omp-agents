/**
 * Proves what a browser smoke check saw on a running dashboard: first that the server serves this checkout as it is
 * now, then that the tab ran the page the server built, then whether each expected text shows or stays away, with a
 * screenshot and a report in `tmp/smoke/<run>/`. It starts no server: `--omp` is a running dashboard's sign-in address.
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Locator, type Page } from "playwright-core";
import { describeServed, describeSource, type Provenance, type ServedBuild, type SourceIdentity } from "../src/served-build";
import { pageBuild } from "../src/server/page";
import { checkServed, defaultRun, provenanceProblem } from "./served";

const USAGE = `Usage: bun scripts/smoke-proof.ts --omp <url with ?token=> [--route <hash>] [--expect <text>]... [--expect-absent <text>]... [--timeout <seconds, default 15>] [--checkout <dir>] [--run <name>]`;

const VIEWPORT = { width: 1920, height: 1080 };
const LOAD_TIMEOUT_MS = 60_000;
const POLL_MS = 250;
/** Lets the page draw the roster it just heard before an absent text counts as absent. */
const SETTLE_MS = 600;

/** A text the page should show, or should not, and whether it did when the run ended; `null` when the run never looked. */
interface Expectation {
	text: string;
	wanted: "visible" | "absent";
	held: boolean | null;
}

/** Whether the tab ran the page the server built: `loaded` is `pageBuild` of the `index.html` the tab loaded. */
interface PageCheck {
	served: string;
	loaded: string;
	matches: boolean;
}

interface Report {
	run: string;
	at: string;
	/** The sign-in address without its token. */
	url: string;
	route: string | null;
	local: SourceIdentity;
	served: ServedBuild;
	provenance: Provenance;
	page: PageCheck | null;
	expectations: Expectation[];
	screenshot: string | null;
	passed: boolean;
}

function markdown(report: Report): string {
	const { page } = report;
	const lines = [
		`# Smoke proof ${report.run}`,
		"",
		`${report.passed ? "Passed" : "Failed"} at ${report.at}.`,
		`Served ${describeServed(report.served)}, pid ${report.served.pid}, started ${report.served.startedAt}.`,
		`Local ${describeSource(report.local)}.`,
		`Provenance: ${provenanceProblem(report.provenance) ?? "the server serves this checkout as it is now."}`,
		`Address ${report.url}, route ${report.route === null ? "none" : `\`#${report.route}\``}, viewport ${VIEWPORT.width}×${VIEWPORT.height}.`,
		`Page: ${page === null ? "not checked." : page.matches ? `the tab ran the served page ${page.served}.` : `the tab ran page ${page.loaded}, not the served page ${page.served}.`}`,
	];
	if (report.expectations.length > 0) {
		lines.push("", "| Expected | Text | Result |", "| --- | --- | --- |", ...report.expectations.map(e => `| ${e.wanted} | ${e.text.replaceAll("|", "\\|")} | ${e.held === null ? "not checked" : e.held ? "held" : "failed"} |`));
	}
	if (report.screenshot) lines.push("", `![screenshot](${report.screenshot})`);
	return `${lines.join("\n")}\n`;
}

async function writeReport(root: string, report: Report): Promise<void> {
	await Promise.all([Bun.write(join(root, "report.json"), `${JSON.stringify(report, null, "\t")}\n`), Bun.write(join(root, "report.md"), markdown(report))]);
}

/** Settles once the dashboard's socket brought the roster, the first message after the build that the page draws from. */
function rosterHeard(tab: Page): Promise<void> {
	const { promise, resolve: heard } = Promise.withResolvers<void>();
	tab.on("websocket", socket => {
		if (new URL(socket.url()).pathname !== "/ws") return;
		socket.on("framereceived", ({ payload }) => {
			if (typeof payload === "string" && payload.startsWith('{"t":"roster"')) heard();
		});
	});
	return promise;
}

/**
 * Whether any of `matches` shows inside the viewport, as the screenshot does: a match scrolled out of view, such as a
 * past session's title far down the sidebar, would otherwise count as shown.
 */
async function onScreen(matches: Locator): Promise<boolean> {
	for (const match of await matches.filter({ visible: true }).all()) {
		const box = await match.boundingBox();
		if (box && box.x < VIEWPORT.width && box.y < VIEWPORT.height && box.x + box.width > 0 && box.y + box.height > 0) return true;
	}
	return false;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			omp: { type: "string" },
			route: { type: "string" },
			expect: { type: "string", multiple: true, default: [] },
			"expect-absent": { type: "string", multiple: true, default: [] },
			timeout: { type: "string", default: "15" },
			checkout: { type: "string" },
			run: { type: "string" },
		},
	});
	if (!values.omp) {
		console.error(USAGE);
		process.exit(1);
	}
	const timeoutMs = Number(values.timeout) * 1000;
	if (!(timeoutMs > 0)) throw new Error(`--timeout takes a number of seconds, not ${values.timeout}`);
	const route = values.route?.replace(/^#/, "") ?? null;

	const check = await checkServed(values.omp, values.checkout === undefined ? undefined : resolve(values.checkout));
	const run = values.run ?? defaultRun(check.local);
	const root = join(import.meta.dir, "..", "tmp", "smoke", run);
	await mkdir(root, { recursive: true });
	const report: Report = {
		run,
		at: new Date().toISOString(),
		url: check.url,
		route,
		local: check.local,
		served: check.served,
		provenance: check.provenance,
		page: null,
		expectations: [
			...values.expect.map((text): Expectation => ({ text, wanted: "visible", held: null })),
			...values["expect-absent"].map((text): Expectation => ({ text, wanted: "absent", held: null })),
		],
		screenshot: null,
		passed: false,
	};

	const problem = provenanceProblem(check.provenance);
	if (problem) {
		console.error(problem);
		await writeReport(root, report);
		console.log(root);
		process.exit(1);
	}

	const browser = await chromium.launch();
	try {
		const tab = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
		const roster = rosterHeard(tab);
		// The sign-in page replaces itself with `/`, keeping the hash; that answer is the served `index.html`.
		const index = tab.waitForResponse(answer => {
			const url = new URL(answer.url());
			return url.pathname === "/" && !url.searchParams.has("token");
		}, { timeout: LOAD_TIMEOUT_MS });
		const url = new URL(values.omp);
		url.hash = route ?? "";
		await tab.goto(url.href, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
		const loaded = await pageBuild(new Map([["/index.html", new Blob([await (await index).text()])]]));
		report.page = { served: check.served.page, loaded, matches: loaded === check.served.page };

		await Promise.race([roster, Bun.sleep(LOAD_TIMEOUT_MS).then(() => Promise.reject(new Error(`The dashboard's socket sent no roster within ${LOAD_TIMEOUT_MS} ms`)))]);
		await Bun.sleep(SETTLE_MS);
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			for (const expectation of report.expectations) {
				const shown = await onScreen(tab.getByText(expectation.text, { exact: true }));
				expectation.held = expectation.wanted === "visible" ? shown : !shown;
			}
			if (report.expectations.every(expectation => expectation.held) || Date.now() >= deadline) break;
			await Bun.sleep(POLL_MS);
		}
		report.screenshot = "screenshot.png";
		await tab.screenshot({ path: join(root, report.screenshot), animations: "disabled", caret: "hide" });
	} finally {
		await browser.close();
	}

	report.passed = report.page.matches && report.expectations.every(expectation => expectation.held);
	await writeReport(root, report);
	console.log(root);
	if (!report.page.matches) console.error(`The tab ran page ${report.page.loaded}, not the served page ${report.page.served}.`);
	for (const expectation of report.expectations) if (!expectation.held) console.error(`Expected ${JSON.stringify(expectation.text)} ${expectation.wanted}, and it was not.`);
	process.exit(report.passed ? 0 : 1);
}

await main();
