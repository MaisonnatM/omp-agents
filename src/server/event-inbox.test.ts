import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventInbox } from "./event-inbox";
import { LocalEventsFile } from "./local-events-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Kit {
	inbox: string;
	events: LocalEventsFile;
}

function config(): Kit {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	dirs.push(dir);
	mkdirSync(join(dir, "event-inbox"));
	return { inbox: join(dir, "event-inbox"), events: new LocalEventsFile(join(dir, "events.json")) };
}

const when = { allDay: false, start: Date.parse("2026-11-05T09:00:00Z"), end: Date.parse("2026-11-05T09:30:00Z") } as const;
const reminder = (id: string, sessionId?: string) => ({ id, title: "Check the build time", when, ...(sessionId ? { sessionId } : {}) });

function drain({ inbox, events }: Kit): Promise<void> {
	return new EventInbox(inbox, () => events.value, change => events.apply(change)).drain();
}

describe("EventInbox", () => {
	test("keeps a session's reminder and removes it at that session's request, and sets aside an add in no session's name", async () => {
		const kit = config();
		writeFileSync(join(kit.inbox, "1-x.json"), JSON.stringify({ op: "add", event: reminder("a", "s1") }));
		writeFileSync(join(kit.inbox, "2-x.json"), JSON.stringify({ op: "add", event: reminder("b") }));
		writeFileSync(join(kit.inbox, "3-x.json"), JSON.stringify({ op: "add", event: reminder("c", "s1") }));
		writeFileSync(join(kit.inbox, "4-x.json"), JSON.stringify({ op: "remove", id: "c", sessionId: "s1" }));
		await drain(kit);
		expect(kit.events.value).toEqual([reminder("a", "s1")]);
		expect(readdirSync(kit.inbox)).toEqual(["2-x.json.invalid"]);
	});

	test("sets aside the removal of an event you or another session added", async () => {
		const kit = config();
		const yours = kit.events.add("Dentist", when);
		kit.events.apply({ op: "add", event: reminder("theirs", "s2") });
		writeFileSync(join(kit.inbox, "1-x.json"), JSON.stringify({ op: "remove", id: yours.id, sessionId: "s1" }));
		writeFileSync(join(kit.inbox, "2-x.json"), JSON.stringify({ op: "remove", id: "theirs", sessionId: "s1" }));
		await drain(kit);
		expect(kit.events.value.map(event => event.id)).toEqual([yours.id, "theirs"]);
		expect(readdirSync(kit.inbox).sort()).toEqual(["1-x.json.invalid", "2-x.json.invalid"]);
	});

	test("an event the dashboard already keeps is not added twice", async () => {
		const kit = config();
		writeFileSync(join(kit.inbox, "1-x.json"), JSON.stringify({ op: "add", event: reminder("a", "s1") }));
		writeFileSync(join(kit.inbox, "2-x.json"), JSON.stringify({ op: "add", event: reminder("a", "s1") }));
		await drain(kit);
		expect(kit.events.value).toEqual([reminder("a", "s1")]);
		expect(readdirSync(kit.inbox)).toEqual([]);
	});
});
