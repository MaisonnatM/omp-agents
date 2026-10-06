import { describe, expect, test } from "bun:test";
import type { ServerMsg } from "../shared/protocol";
import type { PastSession } from "../shared/sessions";
import { Broadcasts } from "./broadcasts";
import type { Socket, SocketData } from "./views";

/** Only the fields the broadcast compares; the rest of a past row does not matter here. */
const past = (sessionId: string, title: string): PastSession => ({ sessionId, title }) as unknown as PastSession;

function setup(initial: PastSession[]) {
	let sessions = initial;
	let listeners = 0;
	const published: ServerMsg[] = [];
	const broadcasts = new Broadcasts({
		rosterMsg: () => ({ t: "roster", hosts: [], registryError: null }) as unknown as Extract<ServerMsg, { t: "roster" }>,
		past: () => sessions,
		userTodosMsg: () => ({ t: "user-todos" }) as unknown as Extract<ServerMsg, { t: "user-todos" }>,
		routinesMsg: () => ({ t: "routines" }) as unknown as Extract<ServerMsg, { t: "routines" }>,
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
	return { broadcasts, ws, sent, pastPublished, setSessions: (next: PastSession[]) => void (sessions = next) };
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
