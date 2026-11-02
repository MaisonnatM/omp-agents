import { describe, expect, test } from "bun:test";
import { trimChangelog } from "./trim-changelog";

const LOG = "# What's new\n\nIntro.\n\n## 2026-11-02\n\n- Newest.\n\n## 2026-11-01\n\n- Middle.\n\n## 2026-10-31\n\n- Oldest.\n";

describe("trimChangelog", () => {
	test("leaves a file that fits unchanged", () => {
		expect(trimChangelog(LOG, LOG.length)).toBe(LOG);
	});

	test("drops whole days from the oldest until the file fits, keeping the title and intro", () => {
		const trimmed = trimChangelog(LOG, LOG.length - 1);
		expect(trimmed).toBe("# What's new\n\nIntro.\n\n## 2026-11-02\n\n- Newest.\n\n## 2026-11-01\n\n- Middle.\n");
	});

	test("always keeps the newest day, even past the limit", () => {
		expect(trimChangelog(LOG, 10)).toBe("# What's new\n\nIntro.\n\n## 2026-11-02\n\n- Newest.\n");
	});
});
