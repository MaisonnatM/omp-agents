/**
 * Screenshots omp's pull request panel, and T3 Code's when `--t3` names a running T3 Code, in the same states at one
 * viewport and panel width, then writes each pair side by side with a pixelmatch diff and a report of the diff ratios.
 * It starts no server: `--omp` is a running dashboard's sign-in address, which must serve this checkout as it is now.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pixelmatch from "pixelmatch";
import { type BrowserContext, chromium, type Locator, type Page, type Request } from "playwright-core";
import { PNG } from "pngjs";
import { describeServed, type ServedBuild } from "../src/served-build";
import { checkServed, defaultRun, provenanceProblem } from "./served";

const USAGE = `Usage: bun scripts/pr-parity.ts --omp <url with ?token=> [--t3 <url>] [--pr owner/repo#N] [--draft N] [--merged N] [--closed N] [--theme light|dark|both] [--page <hash>]... [--run <name>]`;

const VIEWPORT = { width: 1440, height: 900 };
const PANEL_WIDTH = 720;
const SETTLE_MS = 600;
const LOAD_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 5_000;
const GUTTER = 16;
const MASK_COLOR = "#ff00ff";

const MASKS = {
	selectors: ['img[src*="avatars.githubusercontent.com"]', "time"],
	text: /^(([A-Za-z]+ ){0,2}(\d+\s?[a-z]+ ago|just now)|Today|Yesterday)$/,
};

type Side = "omp" | "t3";
type Theme = "light" | "dark";
type Tab = "summary" | "timeline" | "code";
type Control = "checks" | "menu" | "checkout" | "composer";

interface PullRequestRef {
	owner: string;
	repo: string;
	number: number;
}

interface App {
	side: Side;
	url(pr: PullRequestRef): string;
	pin(context: BrowserContext): Promise<unknown>;
	panel(page: Page): Locator;
	tab(panel: Locator, tab: Tab): Locator;
	control(panel: Locator, control: Control): Locator;
	busy(page: Page): Locator;
}

interface State {
	name: string;
	tab: Tab;
	open?: Control;
	scroll?: true;
}

const STATES: State[] = [
	{ name: "summary", tab: "summary" },
	{ name: "timeline", tab: "timeline" },
	{ name: "code", tab: "code" },
	{ name: "checks", tab: "summary", open: "checks" },
	{ name: "menu", tab: "summary", open: "menu" },
	{ name: "checkout", tab: "summary", open: "checkout" },
	{ name: "composer", tab: "summary", open: "composer" },
	{ name: "scrolled", tab: "summary", scroll: true },
];

const STATE_PULL_REQUEST_STATES = STATES.filter(state => state.name === "summary");

const TAB_LABEL: Record<Tab, string> = { summary: "Summary", timeline: "Timeline", code: "Code" };
const COMPOSER_LABEL = /^(Comment on|Review) pull request/;

const omp = (base: string): App => ({
	side: "omp",
	url: pr => {
		const url = new URL(base);
		url.hash = `pull-requests/${pr.owner}/${pr.repo}/${pr.number}`;
		return url.href;
	},
	pin: context =>
		context.addInitScript(width => {
			document.addEventListener("DOMContentLoaded", () => {
				const style = document.createElement("style");
				style.textContent = `[class~="@container/pr"] { width: ${width}px; flex: none; }`;
				document.head.append(style);
			});
		}, PANEL_WIDTH),
	panel: page => page.locator('[class~="@container/pr"]'),
	tab: (panel, tab) => panel.getByRole("tab", { name: new RegExp(`^${TAB_LABEL[tab]}`) }),
	control: (panel, control) => {
		if (control === "checks") return panel.getByRole("button", { name: /^Checks:/ });
		if (control === "menu") return panel.getByRole("button", { name: "More pull request actions" });
		if (control === "composer") return panel.getByRole("button", { name: COMPOSER_LABEL });
		return panel.getByRole("button", { name: "Check out" });
	},
	busy: page => page.getByText(/^(Asking GitHub for the pull request|Reading changes)…$/),
});

const t3 = (base: string): App => ({
	side: "t3",
	url: pr => {
		const url = new URL(base);
		url.pathname = "/pull-requests";
		url.searchParams.set("repository", `${pr.owner}/${pr.repo}`);
		url.searchParams.set("number", String(pr.number));
		return url.href;
	},
	pin: context => context.addInitScript(width => localStorage.setItem("t3code:pull-request-panel-width", String(width)), PANEL_WIDTH),
	panel: page => page.locator("div.flex-col.bg-background", { has: page.locator('nav[aria-label="Pull request tabs"]') }).last(),
	tab: (panel, tab) => panel.locator('nav[aria-label="Pull request tabs"]').getByText(TAB_LABEL[tab], { exact: true }),
	control: (panel, control) => {
		if (control === "checks") return panel.getByRole("button", { name: /^(Open )?checks:/i });
		if (control === "menu") return panel.getByRole("button", { name: "More pull request actions" });
		if (control === "composer") return panel.getByRole("button", { name: COMPOSER_LABEL });
		return panel.getByRole("button", { name: "Check out" });
	},
	busy: page => page.locator('[class*="animate-skeleton"], [data-slot="skeleton"]'),
});

function parsePullRequest(text: string): PullRequestRef {
	const match = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text);
	if (!match) throw new Error(`--pr takes owner/repo#N, not ${text}`);
	return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

const masks = (page: Page): Locator[] => [...MASKS.selectors.map(selector => page.locator(selector)), page.getByText(MASKS.text)];

function networkQuiet(page: Page): () => Promise<void> {
	const pending = new Set<Request>();
	let changed = Date.now();
	const end = (request: Request): void => {
		if (pending.delete(request)) changed = Date.now();
	};
	page.on("request", request => {
		if (request.resourceType() !== "fetch" && request.resourceType() !== "xhr") return;
		pending.add(request);
		changed = Date.now();
	});
	page.on("requestfinished", end);
	page.on("requestfailed", end);
	return async () => {
		const deadline = Date.now() + LOAD_TIMEOUT_MS;
		while (pending.size > 0 || Date.now() - changed < SETTLE_MS) {
			if (Date.now() > deadline) throw new Error(`Requests still pending after ${LOAD_TIMEOUT_MS} ms: ${[...pending].map(request => request.url()).join(", ")}`);
			await Bun.sleep(100);
		}
	};
}

async function settle(app: App, page: Page, panel: Locator, quiet: () => Promise<void>): Promise<void> {
	await panel.waitFor({ state: "visible", timeout: LOAD_TIMEOUT_MS });
	await app.busy(page).first().waitFor({ state: "hidden", timeout: LOAD_TIMEOUT_MS });
	await quiet();
	await panel.evaluate((element, wait) => {
		const { promise: timeout, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, wait);
		return Promise.race([Promise.all([...element.querySelectorAll("img")].map(image => image.decode().catch(() => undefined))), timeout]);
	}, IMAGE_TIMEOUT_MS);
}

const scrollPanel = (panel: Locator): Promise<void> =>
	panel.evaluate(element => {
		const scrollers = [element, ...element.querySelectorAll("*")].filter(node => node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY));
		const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
		if (scroller) scroller.scrollTop = Math.min(400, scroller.scrollHeight - scroller.clientHeight);
	});

async function capture(app: App, context: BrowserContext, pr: PullRequestRef, state: State, file: string): Promise<boolean> {
	const page = await context.newPage();
	const quiet = networkQuiet(page);
	try {
		await page.goto(app.url(pr), { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
		const panel = app.panel(page);
		await settle(app, page, panel, quiet);
		if (state.tab !== "summary") {
			await app.tab(panel, state.tab).click();
			await settle(app, page, panel, quiet);
		}
		if (state.open) {
			const control = app.control(panel, state.open);
			if ((await control.count()) === 0) return false;
			await control.click();
			await page.locator('[role="menu"], [role="dialog"]').last().waitFor({ state: "visible", timeout: LOAD_TIMEOUT_MS });
		}
		if (state.scroll) await scrollPanel(panel);
		await page.waitForTimeout(SETTLE_MS);
		const clip = await panel.boundingBox();
		if (!clip) throw new Error(`${app.side}: the panel has no box in ${state.name}`);
		await page.screenshot({ path: file, clip, animations: "disabled", caret: "hide", mask: masks(page), maskColor: MASK_COLOR });
		return true;
	} finally {
		await page.close();
	}
}

async function capturePage(base: string, context: BrowserContext, hash: string, file: string): Promise<void> {
	const page = await context.newPage();
	const quiet = networkQuiet(page);
	try {
		const url = new URL(base);
		url.hash = hash;
		await page.goto(url.href, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
		await quiet();
		await page.screenshot({ path: file, animations: "disabled", caret: "hide", mask: masks(page), maskColor: MASK_COLOR });
	} finally {
		await page.close();
	}
}

async function compare(ompFile: string, t3File: string, sideBySide: string, diffFile: string): Promise<number> {
	const [left, right] = await Promise.all([ompFile, t3File].map(async file => PNG.sync.read(Buffer.from(await Bun.file(file).arrayBuffer()))));
	const width = Math.max(left.width, right.width);
	const height = Math.max(left.height, right.height);
	const pad = (image: PNG): PNG => {
		const padded = new PNG({ width, height, fill: true });
		PNG.bitblt(image, padded, 0, 0, image.width, image.height, 0, 0);
		return padded;
	};
	const pair = new PNG({ width: width * 2 + GUTTER, height, fill: true });
	pair.data.fill(128);
	PNG.bitblt(left, pair, 0, 0, left.width, left.height, 0, 0);
	PNG.bitblt(right, pair, 0, 0, right.width, right.height, width + GUTTER, 0);
	const diff = new PNG({ width, height });
	const differing = pixelmatch(pad(left).data, pad(right).data, diff.data, width, height, { threshold: 0.1 });
	await Promise.all([Bun.write(sideBySide, PNG.sync.write(pair)), Bun.write(diffFile, PNG.sync.write(diff))]);
	return differing / (width * height);
}

interface Row {
	theme: Theme;
	pr: PullRequestRef;
	state: string;
	captured: Record<Side, boolean | null>;
	ratio: number | null;
}

const cell = (captured: boolean | null): string => (captured === null ? "not run" : captured ? "captured" : "absent");

function report(run: string, served: ServedBuild, rows: Row[], pages: string[]): string {
	const lines = [
		`# Parity run ${run}`,
		"",
		`Served ${describeServed(served)}; viewport ${VIEWPORT.width}×${VIEWPORT.height}, panel ${PANEL_WIDTH}px, masked in ${MASK_COLOR}.`,
		"",
		"| Theme | Pull request | State | omp | T3 | Diff |",
		"| --- | --- | --- | --- | --- | --- |",
		...rows.map(row => `| ${row.theme} | ${row.pr.owner}/${row.pr.repo}#${row.pr.number} | ${row.state} | ${cell(row.captured.omp)} | ${cell(row.captured.t3)} | ${row.ratio === null ? "" : `${(row.ratio * 100).toFixed(2)}%`} |`),
	];
	if (pages.length > 0) lines.push("", `Pages: ${pages.map(hash => `\`#${hash}\``).join(", ")}.`);
	return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			omp: { type: "string" },
			t3: { type: "string" },
			pr: { type: "string", default: "yampa-ai/yampa#6833" },
			draft: { type: "string" },
			merged: { type: "string" },
			closed: { type: "string" },
			theme: { type: "string", default: "both" },
			page: { type: "string", multiple: true, default: [] },
			run: { type: "string" },
		},
	});
	if (!values.omp) {
		console.error(USAGE);
		process.exit(1);
	}
	const themes: Theme[] = values.theme === "both" ? ["light", "dark"] : values.theme === "light" || values.theme === "dark" ? [values.theme] : [];
	if (themes.length === 0) throw new Error(`--theme takes light, dark, or both, not ${values.theme}`);
	const target = parsePullRequest(values.pr);
	const others = [values.draft, values.merged, values.closed].filter(number => number !== undefined).map(number => ({ ...target, number: Number(number) }));
	const targets = [{ pr: target, states: STATES }, ...others.map(pr => ({ pr, states: STATE_PULL_REQUEST_STATES }))];
	const apps = [omp(values.omp), ...(values.t3 ? [t3(values.t3)] : [])];
	const pages = values.page.map(hash => hash.replace(/^#/, ""));

	const check = await checkServed(values.omp);
	const problem = provenanceProblem(check.provenance);
	if (problem) {
		console.error(problem);
		process.exit(1);
	}
	const run = values.run ?? defaultRun(check.local);
	const root = join(import.meta.dir, "..", "tmp", "parity", run);

	const browser = await chromium.launch();
	const rows: Row[] = [];
	try {
		for (const theme of themes) {
			const dir = join(root, theme);
			await mkdir(dir, { recursive: true });
			const captured = new Map<string, Record<Side, boolean | null>>();
			for (const app of apps) {
				const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, reducedMotion: "reduce" });
				await app.pin(context);
				for (const { pr, states } of targets) {
					for (const state of states) {
						const name = `${pr.number}-${state.name}`;
						const sides = captured.get(name) ?? { omp: null, t3: null };
						sides[app.side] = await capture(app, context, pr, state, join(dir, `${name}.${app.side}.png`));
						captured.set(name, sides);
					}
				}
				if (app.side === "omp") for (const hash of pages) await capturePage(values.omp, context, hash, join(dir, `page-${hash.replace(/[^\w-]+/g, "-")}.omp.png`));
				await context.close();
			}
			for (const { pr, states } of targets) {
				for (const state of states) {
					const name = `${pr.number}-${state.name}`;
					const sides = captured.get(name)!;
					const ratio = sides.omp && sides.t3 ? await compare(join(dir, `${name}.omp.png`), join(dir, `${name}.t3.png`), join(dir, `${name}.side-by-side.png`), join(dir, `${name}.diff.png`)) : null;
					rows.push({ theme, pr, state: state.name, captured: sides, ratio });
				}
			}
		}
	} finally {
		await browser.close();
	}
	await Bun.write(join(root, "report.md"), report(run, check.served, rows, pages));
	console.log(root);
}

await main();
