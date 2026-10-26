/**
 * Drives a running dashboard through a fixed script and checks that Settings › Activity counted exactly it: six views,
 * three shortcuts, two palette commands, and one prompt that starts a session in `/tmp`. It reads
 * `GET /api/activity?range=today` before and after and compares the difference with what the script did.
 * With `--agent` it keeps the browser's automation flags and checks that nothing was recorded.
 * It starts no server; point it at one you started, such as a smoke server.
 * Usage: `bun scripts/activity-reconcile.ts --url http://127.0.0.1:<port> --token <token> [--agent]`.
 */
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";
import { decodeActivity, type ActivityRead } from "../src/shared/activity";
import { TOKEN_STORAGE_KEY } from "../src/shared/access";

const { values } = parseArgs({ options: { url: { type: "string" }, token: { type: "string" }, agent: { type: "boolean", default: false } } });
if (!values.url || !values.token) {
	console.error("usage: bun scripts/activity-reconcile.ts --url http://127.0.0.1:<port> --token <token> [--agent]");
	process.exit(2);
}
const base = values.url.replace(/\/$/, "");
const token = values.token;
/** Longer than the recorder's 10-second flush. */
const FLUSH_WAIT_MS = 12_000;

async function readActivity(): Promise<ActivityRead> {
	const response = await fetch(`${base}/api/activity?range=today`, { headers: { authorization: `Bearer ${token}` } });
	if (!response.ok) throw new Error(`GET /api/activity answered ${response.status}`);
	const read = decodeActivity(await response.json());
	if (!read) throw new Error("GET /api/activity answered an unexpected shape");
	return read;
}

/** Each use's count, and a command's keyboard and palette counts, by `kind:key` and `kind:key:via`. */
function counts(read: ActivityRead): Map<string, number> {
	const result = new Map<string, number>();
	for (const use of read.uses) {
		result.set(`${use.kind}:${use.key}`, use.count);
		if (use.kind === "command") {
			result.set(`command:${use.key}:keyboard`, use.keyboard);
			result.set(`command:${use.key}:palette`, use.palette);
		}
	}
	return result;
}

/** What the script does, as the difference it makes. */
const EXPECTED: Record<string, number> = {
	"view:home": 2,
	"view:settings/analytics": 1,
	"view:todo": 1,
	"view:notes": 1,
	"view:calendar": 1,
	"view:new": 1,
	// Each palette opening is the switcher's shortcut.
	"command:switcher": 2,
	"command:switcher:keyboard": 2,
	"command:hide-tools": 2,
	"command:hide-tools:keyboard": 2,
	"command:hide-thinking": 2,
	"command:hide-thinking:keyboard": 1,
	"command:hide-thinking:palette": 1,
	"command:tools": 1,
	"command:tools:palette": 1,
	"action:start": 1,
};

async function runCommand(page: Page, title: string): Promise<void> {
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type(title);
	await page.waitForTimeout(300);
	await page.keyboard.press("Enter");
	await page.waitForTimeout(300);
}

async function script(page: Page): Promise<void> {
	await page.goto(`${base}/`);
	await page.waitForTimeout(1_500);
	for (const hash of ["#settings/analytics", "#todo", "#notes", "#calendar", "#"]) {
		await page.evaluate(next => (location.hash = next), hash);
		await page.waitForTimeout(500);
	}
	await page.keyboard.press("ControlOrMeta+Shift+e");
	await page.keyboard.press("ControlOrMeta+Shift+e");
	await page.keyboard.press("Alt+t");
	await runCommand(page, "Toggle tool calls");
	await runCommand(page, "Show or hide thinking");
	await page.evaluate(() => (location.hash = "#new/%2Ftmp"));
	const composer = page.getByRole("textbox", { name: "Message" });
	await composer.click();
	await page.keyboard.type("activity reconcile: reply with ok");
	await page.keyboard.press("Enter");
	await page.waitForTimeout(FLUSH_WAIT_MS);
}

const before = await readActivity();
const browser = await chromium.launch(values.agent ? {} : { ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"] });
try {
	const context = await browser.newContext();
	await context.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [TOKEN_STORAGE_KEY, token]);
	await script(await context.newPage());
} finally {
	await browser.close();
}
const after = await readActivity();
const was = counts(before);
const now = counts(after);
const delta = (key: string): number => (now.get(key) ?? 0) - (was.get(key) ?? 0);

if (values.agent) {
	const recorded = after.uses.reduce((sum, use) => sum + use.count, 0) - before.uses.reduce((sum, use) => sum + use.count, 0);
	if (recorded === 0) {
		console.log("reconcile: 0 rows recorded for automated browser");
		process.exit(0);
	}
	console.log(`reconcile: ${recorded} rows recorded for automated browser`);
	process.exit(1);
}

const differences = Object.entries(EXPECTED).filter(([key, count]) => delta(key) !== count).map(([key, count]) => `${key}: expected ${count}, got ${delta(key)}`);
// A command or control the script never ran is a difference too.
for (const key of now.keys()) if (/^(command|control):[^:]+$/.test(key) && !(key in EXPECTED) && delta(key) !== 0) differences.push(`${key}: expected 0, got ${delta(key)}`);
if (differences.length === 0) {
	console.log("reconcile: 0 differences");
	process.exit(0);
}
console.log(`reconcile: ${differences.length} differences`);
for (const line of differences) console.log(`  ${line}`);
process.exit(1);
