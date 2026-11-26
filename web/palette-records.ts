/** The pull requests and conversation matches the command palette searches, each opening where the dashboard shows it. */
import { IconAiBotHead, IconLayoutColumn, IconUser, IconWindowApp } from "central-icons";
import { prKey, pullRequestName, pullRequestUrl, type RepoPullRequests } from "../src/shared/github";
import type { ConversationHit, PastSession, RosterHost, View } from "../src/shared/sessions";
import type { Accessory, PaletteItem } from "./command-palette";
import { hostLabel, pastLabel } from "./labels";
import { PAGE_ICON } from "./page-icons";
import { listedPullRequests } from "./pull-requests-model";
import { hashForPullRequests, type OpenMode } from "./routing";
import { type SessionEntry, viewOf } from "./session-actions";
import { workspaceCwd } from "./sessions";

export interface PaletteRecords {
	/** The open pull requests of the sidebar's workspace. */
	pullRequestRepos: readonly RepoPullRequests[];
}

/** One palette item for every pull request. */
export function recordItems({ pullRequestRepos }: PaletteRecords): PaletteItem[] {
	return listedPullRequests(pullRequestRepos).map((pr): PaletteItem => {
		const icon = PAGE_ICON["pull-requests"];
		return {
			id: `pr:${prKey(pr)}`,
			section: "pullRequests",
			title: pr.title,
			subtitle: pullRequestName(pr),
			keywords: [pr.head, pr.author.login],
			icon,
			accessories: [{ kind: "age", at: pr.updatedAt }],
			kind: "PR",
			actions: [
				[
					{ id: "open", title: "Open pull request", icon, run: { kind: "link", href: hashForPullRequests(pr) } },
					{ id: "github", title: "Open on GitHub", icon, run: { kind: "link", href: pullRequestUrl(pr), external: true } },
				],
			],
		};
	});
}

/** Open `view`, whose session counts in workspace `workspace`, in the focused pane or a split, scrolled to message `messageId`. */
export type OpenAt = (view: View, workspace: string, mode: OpenMode, messageId: string) => void;

/** The most conversation matches the palette lists. */
const MAX_CONVERSATION_ITEMS = 30;

/**
 * One palette item for each conversation match of a session the sidebar lists, the server's order kept, opening it at
 * the matching message, up to {@link MAX_CONVERSATION_ITEMS}; a match in a session the sidebar hides, such as one in `/tmp`, is left out.
 */
export function conversationItems(hits: readonly ConversationHit[], hosts: readonly RosterHost[], past: readonly PastSession[], openAt: OpenAt): PaletteItem[] {
	// A session that runs is listed live, so its live entry is set last and wins.
	const entries = new Map<string, SessionEntry>([
		...past.map(session => [session.sessionId, { kind: "past", session }] as const),
		...hosts.map(host => [host.sessionId, { kind: "live", host }] as const),
	]);
	return hits.flatMap((hit): PaletteItem[] => {
		const entry = entries.get(hit.sessionId);
		if (!entry) return [];
		const view = viewOf(entry);
		const cwd = workspaceCwd(entry.kind === "live" ? entry.host : entry.session);
		const matches: Accessory = { kind: "text", text: hit.matches === 1 ? "1 match" : `${hit.matches} matches` };
		const state: Accessory = entry.kind === "live" ? { kind: "status", status: entry.host.status } : { kind: "age", at: entry.session.modifiedAt };
		return [
			{
				id: `conversation:${hit.sessionId}`,
				section: "conversations",
				title: hit.snippet,
				subtitle: entry.kind === "live" ? hostLabel(entry.host) : pastLabel(entry.session),
				keywords: [],
				icon: hit.role === "user" ? IconUser : IconAiBotHead,
				accessories: [matches, state],
				kind: "Message",
				actions: [
					[
						{ id: "open", title: "Open at this message", icon: IconWindowApp, run: { kind: "do", fn: () => openAt(view, cwd, "replace", hit.messageId) } },
						{ id: "split", title: "Open in split at this message", icon: IconLayoutColumn, run: { kind: "do", fn: () => openAt(view, cwd, "split", hit.messageId) } },
					],
				],
			},
		];
	}).slice(0, MAX_CONVERSATION_ITEMS);
}
