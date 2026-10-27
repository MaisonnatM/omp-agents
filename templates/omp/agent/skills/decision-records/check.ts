/**
 * Checks a directory of decision records against the rules in this skill's `SKILL.md`.
 *
 *   bun check.ts [directory]   (default: docs/decisions)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STATUSES = ["proposed", "accepted", "rejected", "deprecated", "superseded"];
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const DATED = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-${SLUG}\\.md$`);
/** Records a repository numbered before it adopted dated names keep their names. */
const NUMBERED = new RegExp(`^\\d{4}-${SLUG}\\.md$`);
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n+/;

interface Fields {
	status?: unknown;
	date?: unknown;
	"decision-makers"?: unknown;
	supersedes?: unknown;
	"superseded-by"?: unknown;
}

const names = (value: unknown): string[] => (value == null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]);

/** Every rule a record in `dir` breaks, one line each, naming the file. */
export function checkDecisions(dir: string): string[] {
	const files = readdirSync(dir).filter(file => file.endsWith(".md")).sort();
	const records = new Map<string, Fields>();
	const problems: string[] = [];
	for (const file of files) {
		const say = (problem: string) => problems.push(`${file}: ${problem}`);
		const dated = DATED.exec(file);
		if (!dated && !NUMBERED.test(file)) say("name it YYYY-MM-DD-slug.md, with a lowercase slug");
		const text = readFileSync(join(dir, file), "utf8");
		const front = FRONTMATTER.exec(text);
		if (!front) {
			say("starts with no --- frontmatter");
			continue;
		}
		const fields = (Bun.YAML.parse(front[1] ?? "") ?? {}) as Fields;
		records.set(file.slice(0, -3), fields);
		if (!STATUSES.includes(String(fields.status))) say(`status is ${String(fields.status)}, not one of ${STATUSES.join(", ")}`);
		const date = fields.date instanceof Date ? fields.date.toISOString().slice(0, 10) : String(fields.date);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) say("date is not YYYY-MM-DD");
		else if (dated && dated[1] !== date) say(`date ${date} differs from the file name's ${dated[1]}`);
		if (names(fields["decision-makers"]).join("").trim() === "") say("decision-makers names no one");
		if (!text.slice(front[0].length).startsWith("# ")) say("has no # title right after the frontmatter");
		if ((fields.status === "superseded") !== (names(fields["superseded-by"]).length > 0)) say("status superseded and superseded-by go together");
	}
	for (const [name, fields] of records) {
		for (const newer of names(fields["superseded-by"])) {
			const target = records.get(newer);
			if (!target) problems.push(`${name}.md: superseded-by ${newer}, which does not exist`);
			else if (!names(target.supersedes).includes(name)) problems.push(`${newer}.md: supersedes does not name ${name}, which it replaced`);
		}
		for (const older of names(fields.supersedes)) {
			const target = records.get(older);
			if (!target) problems.push(`${name}.md: supersedes ${older}, which does not exist`);
			else if (!names(target["superseded-by"]).includes(name)) problems.push(`${older}.md: superseded-by does not name ${name}, which replaced it`);
		}
	}
	return problems;
}

if (import.meta.main) {
	const dir = process.argv[2] ?? "docs/decisions";
	const problems = checkDecisions(dir);
	for (const problem of problems) console.log(problem);
	console.log(problems.length === 0 ? `${dir}: every record follows the rules` : `${dir}: ${problems.length} problems`);
	process.exit(problems.length === 0 ? 0 : 1);
}
