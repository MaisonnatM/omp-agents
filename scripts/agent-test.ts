/**
 * `bun run test:agent [bun test args]`: runs `bun test` and prints a short report for agents to read.
 * One `PASS n FAIL m SKIP k (Ns)` line, then one `ERROR <file> > <test name> > <first line>` line per failure, capped.
 * Exits with `bun test`'s code.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_ERRORS = 30;
const MAX_VALUE = 60;

export interface Failure {
	path: string[];
	detail: string;
}

export interface Report {
	pass: number;
	fail: number;
	skip: number;
	failures: Failure[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
		if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
		if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
		return ENTITIES[name] ?? whole;
	});
}

function attributes(source: string): Record<string, string> {
	const found: Record<string, string> = {};
	for (const [, name, value] of source.matchAll(/([\w:-]+)="([^"]*)"/g)) found[name] = unescapeXml(value);
	return found;
}

function short(value: string): string {
	const trimmed = value.trim();
	return trimmed.length > MAX_VALUE ? `${trimmed.slice(0, MAX_VALUE - 1)}…` : trimmed;
}

/** The first line of a failure, followed by its expected and received values when the message names them. */
export function failureDetail(type: string, message: string): string {
	const lines = message.split("\n");
	const first = (lines.find((line) => line.trim()) ?? "").trim();
	const head = type === "AssertionError" || !type ? first : first ? `${type}: ${first}` : type;
	let expected = lines.map((line) => /^\s*Expected[^:]*:\s*(.*)$/.exec(line)?.[1]).find((value) => value !== undefined);
	let received = lines.map((line) => /^\s*Received[^:]*:\s*(.*)$/.exec(line)?.[1]).find((value) => value !== undefined);
	if (expected === undefined && received === undefined) {
		expected = lines.find((line) => /^-\s/.test(line) && !/^- Expected\s+-/.test(line))?.slice(1).trim().replace(/,$/, "");
		received = lines.find((line) => /^\+\s/.test(line) && !/^\+ Received\s+\+/.test(line))?.slice(1).trim().replace(/,$/, "");
	}
	if (expected === undefined && received === undefined) return head;
	return `${head}: expected ${short(expected ?? "?")}, received ${short(received ?? "?")}`;
}

/** Reads Bun's JUnit report: the counts and each failed test with its describe path. */
export function parseJunit(xml: string): Report {
	const report: Report = { pass: 0, fail: 0, skip: 0, failures: [] };
	const suites: string[] = [];
	let testcase: { file: string; name: string } | undefined;
	let tests = 0;
	for (const [, closing, tag, attrSource] of xml.matchAll(/<(\/?)(testsuites|testsuite|testcase|failure|error|skipped)\b([^>]*)>/g)) {
		const attrs = attributes(attrSource);
		if (tag === "testsuites" && !closing) {
			tests = Number(attrs.tests ?? 0);
			report.fail = Number(attrs.failures ?? 0) + Number(attrs.errors ?? 0);
			report.skip = Number(attrs.skipped ?? 0);
		} else if (tag === "testsuite") {
			if (closing) suites.pop();
			else if (!attrSource.trimEnd().endsWith("/")) suites.push(attrs.name ?? "");
		} else if (tag === "testcase") {
			const selfClosing = attrSource.trimEnd().endsWith("/");
			testcase = closing || selfClosing ? undefined : { file: attrs.file ?? suites[0] ?? "", name: attrs.name ?? "" };
		} else if ((tag === "failure" || tag === "error") && !closing && testcase) {
			report.failures.push({
				path: [testcase.file, ...suites.slice(1), testcase.name],
				detail: failureDetail(attrs.type ?? "", attrs.message ?? ""),
			});
		}
	}
	report.pass = tests - report.fail - report.skip;
	return report;
}

/** Errors Bun reports outside any test, such as a test file that throws while loading; the JUnit report leaves them out. */
export function unhandledErrors(stderr: string): Failure[] {
	const found: Failure[] = [];
	let file = "";
	let inUnhandled = false;
	const lines = stderr.split("\n");
	for (const [index, line] of lines.entries()) {
		const header = /^(\S.*):$/.exec(line);
		if (header && !line.includes(" | ") && (index === 0 || lines[index - 1].trim() === "")) file = header[1];
		else if (line.startsWith("# Unhandled error between tests")) inUnhandled = true;
		else if (inUnhandled && line.startsWith("error: ")) {
			found.push({ path: [file || "bun test", "(unhandled error between tests)"], detail: line.slice("error: ".length).trim() });
			inUnhandled = false;
		}
	}
	return found;
}

/** The lines `bun run test:agent` prints. */
export function formatReport(report: Report, seconds: number, exitCode: number, stderr: string): string[] {
	const failures = [...report.failures, ...unhandledErrors(stderr)];
	const fail = report.fail + failures.length - report.failures.length;
	if (exitCode !== 0 && failures.length === 0) {
		const reason = stderr
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line && !line.startsWith("bun test v"));
		failures.push({ path: ["bun test"], detail: `exit code ${exitCode}${reason ? `: ${reason}` : ""}` });
	}
	const out = [`PASS ${report.pass} FAIL ${fail} SKIP ${report.skip} (${seconds.toFixed(1)}s)`];
	for (const failure of failures.slice(0, MAX_ERRORS)) out.push(`ERROR ${[...failure.path, failure.detail].join(" > ")}`);
	if (failures.length > MAX_ERRORS) out.push(`… and ${failures.length - MAX_ERRORS} more`);
	return out;
}

async function main(): Promise<number> {
	const dir = mkdtempSync(join(tmpdir(), "agent-test-"));
	const outfile = join(dir, "junit.xml");
	try {
		const started = performance.now();
		const child = Bun.spawn([process.execPath, "test", ...process.argv.slice(2), "--reporter=junit", `--reporter-outfile=${outfile}`], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		const seconds = (performance.now() - started) / 1000;
		let xml = "";
		try {
			xml = readFileSync(outfile, "utf8");
		} catch {}
		for (const line of formatReport(parseJunit(xml), seconds, exitCode, Bun.stripANSI(stderr))) console.log(line);
		return exitCode;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

if (import.meta.main) process.exit(await main());
