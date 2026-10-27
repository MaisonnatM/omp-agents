import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecord, readDecisions } from "./decisions";

describe("decision records", () => {
	test("a record reads its frontmatter, its title, and the body after the title", () => {
		const record = parseRecord(
			"2026-10-27-use-sqlite.md",
			"---\nstatus: superseded\ndate: 2026-10-27\ndecision-makers: [Ada, agent]\nsuperseded-by: 2026-11-02-use-postgres\n---\n\n# Use SQLite\n\nIn the context of…\n",
		);
		expect(record).toEqual({
			name: "2026-10-27-use-sqlite",
			title: "Use SQLite",
			status: "superseded",
			date: "2026-10-27",
			decisionMakers: ["Ada", "agent"],
			supersedes: [],
			supersededBy: ["2026-11-02-use-postgres"],
			body: "In the context of…",
		});
	});

	test("a numbered record with no frontmatter still shows, and broken YAML reads as none", () => {
		expect(parseRecord("0003-use-adrs.md", "# 3. Use ADRs\n\n## Status\n\nAccepted\n")).toMatchObject({ title: "3. Use ADRs", status: null, date: null, body: "## Status\n\nAccepted" });
		expect(parseRecord("2026-01-05-x.md", "---\nstatus: [\n---\nno title")).toMatchObject({ title: "2026-01-05-x", status: null, date: "2026-01-05", body: "no title" });
	});

	test("a repository's records come from its first records directory, read from any of its directories, newest first, without a README", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "decisions-")));
		Bun.spawnSync(["git", "init", "-q", root]);
		mkdirSync(join(root, "docs/adr"), { recursive: true });
		mkdirSync(join(root, "src"));
		for (const [file, date] of [["2026-01-01-old.md", "2026-01-01"], ["2026-03-01-new.md", "2026-03-01"]]) writeFileSync(join(root, "docs/adr", file!), `---\ndate: ${date}\n---\n\n# ${file}\n`);
		writeFileSync(join(root, "docs/adr/README.md"), "# Index\n");
		const read = await readDecisions(join(root, "src"));
		expect(read.dir).toBe(join(root, "docs/adr"));
		expect(read.records.map(record => record.name)).toEqual(["2026-03-01-new", "2026-01-01-old"]);
	});

	test("a repository without records reads as none", async () => {
		expect(await readDecisions(mkdtempSync(join(tmpdir(), "decisions-")))).toEqual({ dir: null, dirDisplay: null, records: [] });
	});
});
