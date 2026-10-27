import { expect, test } from "bun:test";
import { readFavicon } from "./favicon";

test("refuses hosts off the public internet without asking them", async () => {
	for (const host of [null, "", "localhost", "127.0.0.1", "10.0.0.1", "[::1]", "printer.local", "db.internal", "intranet", "a.example.com:8080", "evil.com/x"]) {
		expect((await readFavicon(host)).status).toBe(404);
	}
});
