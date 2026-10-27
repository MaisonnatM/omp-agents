import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkDecisions } from "../templates/omp/agent/skills/decision-records/check";

/**
 * Agents read these docs through tools that cut a line at 768 characters and end it with `…`.
 * A longer line hides its tail, and an edit that copies the cut line back writes the `…` into the file.
 * The docs keep one sentence per line, so no line comes near the cut.
 */
const MAX_LINE = 700;
const root = join(import.meta.dir, "..");
const scan = (patterns: string[]) => patterns.flatMap(pattern => [...new Bun.Glob(pattern).scanSync({ cwd: root })]).sort();
const docs = scan(["*.md", "docs/**/*.md", "templates/omp/**/*.md"]);
/** The repository's own docs; the starter kit's name paths on the user's machine. */
const repoDocs = scan(["*.md", "docs/**/*.md"]);

describe("docs stay readable by agents", () => {
	test.each(docs)("%s", file => {
		const lines = readFileSync(join(root, file), "utf8").split("\n");
		const problems = lines.flatMap((line, i) => {
			if (line.length > MAX_LINE) return [`line ${i + 1}: ${line.length} characters; put one sentence on each line`];
			if (line.trimEnd().endsWith("…")) return [`line ${i + 1}: ends in a tool's truncation mark "…"; restore the cut text`];
			return [];
		});
		expect(problems).toEqual([]);
	});
});

/**
 * Agents read a whole doc or grep across one, so a large file costs every reader that opens it.
 * Split a doc that grows past this into one file per feature, as `docs/usage/`, `docs/architecture/`, and `docs/code-layout/` are.
 */
const MAX_BYTES = 32 * 1024;

describe("docs stay small enough to read whole", () => {
	test.each(docs)("%s", file => {
		const bytes = Bun.file(join(root, file)).size;
		expect(bytes > MAX_BYTES ? `${bytes} bytes; split it into files under ${MAX_BYTES} bytes` : null).toBeNull();
	});
});

/** A backticked path from the repository root, such as `web/app.tsx`; spaces, globs, and `<placeholders>` never match. */
const REPO_PATH = /`((?:src|web|desktop|scripts|templates|docs)\/[^`\s*<>{}]*)`/g;
/** Build output the checkout does not hold until a build. */
const BUILD_OUTPUT = ["desktop/dist", "desktop/release", "desktop/node_modules"];
/** A relative Markdown link outside a code span: its file, else the current file, and its anchor; a link with a scheme is not relative. */
const LINK = /\]\((?![a-z][a-z0-9+.-]*:)([^)#\s]*)(?:#([^)\s]+))?\)/g;
const CODE_SPAN = /(`+)[^`].*?\1/g;

/** `lines` with each line of a fenced code block, fences included, blanked, so a shell comment is no heading and an example no claim. */
function prose(lines: string[]): string[] {
	let fenced = false;
	return lines.map(line => {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			return "";
		}
		return fenced ? "" : line;
	});
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchorsOf(text: string): Set<string> {
	const anchors = new Set<string>();
	const seen = new Map<string, number>();
	for (const [, heading] of prose(text.split("\n")).join("\n").matchAll(/^#{1,6} (.+)$/gm)) {
		const slug = heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replaceAll(" ", "-");
		const count = seen.get(slug) ?? 0;
		seen.set(slug, count + 1);
		anchors.add(count ? `${slug}-${count}` : slug);
	}
	return anchors;
}

const anchorCache = new Map<string, Set<string>>();
function anchorsIn(file: string): Set<string> {
	let anchors = anchorCache.get(file);
	if (!anchors) {
		anchors = anchorsOf(readFileSync(join(root, file), "utf8"));
		anchorCache.set(file, anchors);
	}
	return anchors;
}

describe("docs name files and headings that exist", () => {
	test.each(repoDocs)("%s", file => {
		const lines = prose(readFileSync(join(root, file), "utf8").split("\n"));
		const problems = lines.flatMap((line, i) => {
			const found: string[] = [];
			for (const [, path] of line.matchAll(REPO_PATH)) {
				const bare = path.replace(/:\d+(?:-\d+)?$/, "");
				if (BUILD_OUTPUT.some(dir => bare === dir || bare.startsWith(`${dir}/`))) continue;
				if (!existsSync(join(root, bare))) found.push(`line ${i + 1}: \`${path}\` does not exist`);
			}
			for (const [, target, anchor] of line.replace(CODE_SPAN, "").matchAll(LINK)) {
				const linked = target ? join(dirname(file), target) : file;
				if (!existsSync(join(root, linked))) found.push(`line ${i + 1}: link to ${linked}, which does not exist`);
				else if (anchor && linked.endsWith(".md") && !anchorsIn(linked).has(anchor)) found.push(`line ${i + 1}: link to ${linked}#${anchor}, which has no such heading`);
			}
			return found;
		});
		expect(problems).toEqual([]);
	});
});

test("decision records follow the decision-records skill", () => {
	expect(checkDecisions(join(root, "docs/decisions"))).toEqual([]);
});

