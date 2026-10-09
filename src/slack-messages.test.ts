import { describe, expect, test } from "bun:test";
import { waitingOnYou } from "./slack-messages";

const ME = "U0ME";

const message = (fields: Record<string, unknown>) => ({
	author_name: "Ana Lopez",
	author_user_id: "U0ANA",
	team_id: "T1",
	channel_id: "D0ANA",
	channel_name: "",
	message_ts: "1791474489.489989",
	content: "hello",
	is_author_bot: false,
	permalink: "https://acme.slack.com/archives/D0ANA/p1791474489489989",
	...fields,
});

/** Slack's answers by search, newest first and 20 a page: direct and group messages, or mentions in channels. */
const slack =
	(answers: { dms: unknown[]; mentions: unknown[]; error?: string }) =>
	async (url: string): Promise<unknown> => {
		const parsed = new URL(url);
		if (parsed.pathname === "/api/auth.test") return { ok: true, user_id: ME };
		if (answers.error) return { ok: false, error: answers.error };
		const all = parsed.searchParams.get("channel_types") === "im,mpim" ? answers.dms : answers.mentions;
		const from = Number(parsed.searchParams.get("cursor") ?? 0);
		const next = from + 20 < all.length ? String(from + 20) : "";
		return { ok: true, results: { messages: all.slice(from, from + 20), files: [], channels: [], users: [] }, response_metadata: { next_cursor: next } };
	};

describe("waitingOnYou", () => {
	test("a conversation past Slack's first page of results still gives its notice", async () => {
		const chatter = Array.from({ length: 30 }, (_, at) => message({ channel_id: "D0BO", message_ts: `${900 - at}.0`, author_name: "Bo", author_user_id: "U0BO", content: `note ${at}` }));
		const get = slack({ dms: [...chatter, message({ message_ts: "100.0", content: "still there?" })], mentions: [] });
		expect((await waitingOnYou(get, 1_000_000)).map(notice => [notice.id, "count" in notice && notice.count])).toEqual([
			["slack:D0BO:900.0", 30],
			["slack:D0ANA:100.0", 1],
		]);
	});

	test("a conversation gives one notice for the messages since you last wrote there, without bots or empty ones", async () => {
		const get = slack({
			dms: [
				message({ message_ts: "300.0", content: "are you there?", permalink: "https://acme.slack.com/p300" }),
				message({ message_ts: "290.0", content: "ping" }),
				message({ message_ts: "280.0", author_name: "Graphite", author_user_id: "U0BOT", is_author_bot: true, content: "" }),
				message({ message_ts: "270.0", author_name: "Max", author_user_id: ME, content: "on it" }),
				message({ message_ts: "260.0", content: "can you look?" }),
				message({ channel_id: "D0BO", message_ts: "250.0", author_name: "Max", author_user_id: ME, content: "done" }),
				message({ channel_id: "D0BO", message_ts: "240.0", author_name: "Bo", author_user_id: "U0BO", content: "thanks" }),
				message({ channel_id: "C0GROUP", channel_name: "mpdm-ana--bo--max-1", message_ts: "230.0", author_name: "Bo", author_user_id: "U0BO", content: "lunch?" }),
			],
			mentions: [],
		});
		expect(await waitingOnYou(get, 1_000_000)).toEqual([
			{ id: "slack:D0ANA:300.0", at: 300_000, kind: "slack", type: "dm", count: 2, from: "Ana Lopez", text: "are you there?", permalink: "https://acme.slack.com/p300" },
			{ id: "slack:C0GROUP:230.0", at: 230_000, kind: "slack", type: "group-dm", count: 1, from: "Bo", text: "lunch?", permalink: message({}).permalink },
		]);
	});

	test("a mention reads as plain text, and one you or Slack wrote is not one", async () => {
		const get = slack({
			dms: [],
			mentions: [
				message({
					channel_id: "C0ENG",
					channel_name: "eng",
					message_ts: "500.0",
					author_name: "Cy",
					author_user_id: "U0CY",
					content: "<@U0ME|Max> see <https://github.com/acme/webapp/pull/1|the PR> in <#C0ENG|eng> &amp; <!here>\n<https://example.com>",
				}),
				message({ channel_id: "C0ENG", channel_name: "eng", message_ts: "490.0", author_name: "Max", author_user_id: ME, content: "<@U0ME> note to self" }),
				message({ channel_id: "C0NEW", channel_name: "party", message_ts: "480.0", author_name: "", author_user_id: "U00", content: "<@U0CY|Cy> created this channel with <@U0ME|Max>" }),
			],
		});
		expect(await waitingOnYou(get, 1_000_000)).toEqual([
			{ id: "slack:C0ENG:500.0", at: 500_000, kind: "slack", type: "mention", channel: "eng", from: "Cy", text: "@Max see the PR in #eng & @here https://example.com", permalink: message({}).permalink },
		]);
	});

	test("Slack's error fails the check", async () => {
		const get = slack({ dms: [], mentions: [], error: "missing_scope" });
		await expect(waitingOnYou(get, 0)).rejects.toThrow("Slack's search failed: missing_scope");
	});
});
