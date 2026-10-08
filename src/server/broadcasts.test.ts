import { describe, expect, test } from "bun:test";
import type { ServerMsg } from "../shared/protocol";
import type { PastSession, RosterHost } from "../shared/sessions";
import { Broadcasts } from "./broadcasts";
import type { Socket, SocketData } from "./views";

/** Only the fields the broadcast compares; the rest of a past row does not matter here. */
const past = (sessionId: string, title: string): PastSession => ({ sessionId, title }) as unknown as PastSession;
/** Only the fields the broadcast compares. */
const host = (instanceId: string, cwd: string): RosterHost => ({ instanceId, cwd }) as unknown as RosterHost;

function setup(initial: PastSession[]) {
	let sessions = initial;
	let roster: { hosts: RosterHost[]; error: string | null } = { hosts: [], error: null };
	let listeners = 0;
	const published: ServerMsg[] = [];
	const broadcasts = new Broadcasts({
		roster: () => roster,
		past: () => sessions,
		userTodosMsg: () => ({ t: "user-todos" }) as unknown as Extract<ServerMsg, { t: "user-todos" }>,
		routinesMsg: () => ({ t: "routines" }) as unknown as Extract<ServerMsg, { t: "routines" }>,
		projectsMsg: () => ({ t: "projects", list: { added: [], hidden: [] } }),
		noticesMsg: () => ({ t: "notices", list: [] }),
		publish: (_topic, json) => void published.push(JSON.parse(json)),
		subscriberCount: () => listeners,
		beforeRosterPush: () => {},
		saveRunning: () => {},
	});
	const sent: ServerMsg[] = [];
	const ws = {
		data: { views: new Map() } as SocketData,
		send: (raw: string) => void sent.push(JSON.parse(raw)),
		subscribe: () => void listeners++,
	} as unknown as Socket;
	const pastPublished = () => published.filter(msg => msg.t === "past");
	const rosterPublished = () => published.filter(msg => msg.t === "roster");
	return {
		broadcasts,
		ws,
		sent,
		pastPublished,
		rosterPublished,
		setSessions: (next: PastSession[]) => void (sessions = next),
		setRoster: (next: { hosts: RosterHost[]; error: string | null }) => void (roster = next),
	};
}

describe("past list broadcasts", () => {
	test("a socket that opens gets the whole list, and the listeners then hear only the sessions that changed, joined, or left", () => {
		const { broadcasts, ws, sent, pastPublished, setSessions } = setup([past("a", "one"), past("b", "two")]);
		broadcasts.open(ws);
		expect(sent.find(msg => msg.t === "past")).toEqual({ t: "past", reset: true, sessions: [past("a", "one"), past("b", "two")], removed: [] });

		broadcasts.pushPast();
		expect(pastPublished()).toEqual([]);

		setSessions([past("a", "one, renamed"), past("c", "three")]);
		broadcasts.pushPast();
		expect(pastPublished()).toEqual([{ t: "past", reset: false, sessions: [past("a", "one, renamed"), past("c", "three")], removed: ["b"] }]);
	});

	test("a socket that opens after changes nobody heard gets them in its whole list, with no delta published", () => {
		const { broadcasts, ws, sent, pastPublished, setSessions } = setup([past("a", "one")]);
		setSessions([past("b", "two")]);
		broadcasts.pushPast();
		broadcasts.open(ws);
		expect(pastPublished()).toEqual([]);
		expect(sent.find(msg => msg.t === "past")).toEqual({ t: "past", reset: true, sessions: [past("b", "two")], removed: [] });
	});
});

describe("roster broadcasts", () => {
	test("a socket that opens gets the whole roster, and the listeners then hear only the rows that changed, joined, or left, and an error that changed", () => {
		const { broadcasts, ws, sent, rosterPublished, setRoster } = setup([]);
		setRoster({ hosts: [host("a", "/work"), host("b", "/other")], error: null });
		broadcasts.open(ws);
		expect(sent.find(msg => msg.t === "roster")).toEqual({ t: "roster", reset: true, hosts: [host("a", "/work"), host("b", "/other")], removed: [], error: null });

		broadcasts.pushRoster();
		expect(rosterPublished()).toEqual([]);

		setRoster({ hosts: [host("a", "/moved"), host("c", "/new")], error: null });
		broadcasts.pushRoster();
		expect(rosterPublished()).toEqual([{ t: "roster", reset: false, hosts: [host("a", "/moved"), host("c", "/new")], removed: ["b"], error: null }]);

		setRoster({ hosts: [host("a", "/moved"), host("c", "/new")], error: "registry down" });
		broadcasts.pushRoster();
		expect(rosterPublished()[1]).toEqual({ t: "roster", reset: false, hosts: [], removed: [], error: "registry down" });
	});

	test("a socket that connects again gets the whole roster, with the rows nobody heard in it", () => {
		const { broadcasts, ws, sent, rosterPublished, setRoster } = setup([]);
		setRoster({ hosts: [host("a", "/work")], error: null });
		broadcasts.open(ws);
		setRoster({ hosts: [host("b", "/other")], error: null });
		broadcasts.open(ws);
		expect(rosterPublished()).toEqual([{ t: "roster", reset: false, hosts: [host("b", "/other")], removed: ["a"], error: null }]);
		expect(sent.filter(msg => msg.t === "roster").at(-1)).toEqual({ t: "roster", reset: true, hosts: [host("b", "/other")], removed: [], error: null });
	});
});
