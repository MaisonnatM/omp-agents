import type { RosterHost, View } from "../src/shared/sessions";
import { closePane, type Layout, type OpenMode, openView, sameView, viewForSession } from "./routing";

export type SplitAxis = "columns" | "rows";
export type SplitRatios = Readonly<Record<SplitAxis, number>>;
export const DEFAULT_SPLIT_RATIOS: SplitRatios = { columns: 0.5, rows: 0.5 };

/** The conversation a pane shows, which outlives the host that runs it. */
type SplitMember = { kind: "session"; sessionId: string } | { kind: "agent"; sessionId: string; agentId: string };

interface RememberedSplit {
	members: readonly SplitMember[];
	ratios: SplitRatios;
}

/** The divider sizes on screen, and each split the page left for a single session, in the order it was left. */
export interface SplitMemory {
	ratios: SplitRatios;
	groups: readonly RememberedSplit[];
}

export interface PaneNavigation {
	layout: Layout;
	splits: SplitMemory;
}

export type PaneCommand =
	| { kind: "select"; view: View; mode: OpenMode }
	| { kind: "edit"; layout: Layout }
	| { kind: "history"; layout: Layout }
	| { kind: "close"; index: number }
	| { kind: "resize"; axis: SplitAxis; ratio: number }
	| { kind: "forget-session"; sessionId: string };

const memberKey = (member: SplitMember): string => (member.kind === "agent" ? `${member.sessionId}/${member.agentId}` : member.sessionId);

function memberFor(view: View, hosts: RosterHost[]): SplitMember | null {
	if (view.kind === "past") return { kind: "session", sessionId: view.sessionId };
	const host = hosts.find(row => row.instanceId === view.instanceId);
	if (!host?.sessionId) return null;
	return view.agentId === null ? { kind: "session", sessionId: host.sessionId } : { kind: "agent", sessionId: host.sessionId, agentId: view.agentId };
}

function membersFor(layout: Layout, hosts: RosterHost[]): SplitMember[] {
	return layout.panes.flatMap(view => {
		const member = memberFor(view, hosts);
		return member ? [member] : [];
	});
}

/** The roster plus the last row of each open live session that left it, so a pane still names its conversation after its host ends. */
function knownHosts(hosts: RosterHost[], lastHosts: ReadonlyMap<string, RosterHost>): RosterHost[] {
	const departed = [...lastHosts.values()].filter(host => !hosts.some(current => current.instanceId === host.instanceId));
	return departed.length > 0 ? [...hosts, ...departed] : hosts;
}

function withoutMembers(splits: SplitMemory, members: readonly SplitMember[]): SplitMemory {
	const keys = new Set(members.map(memberKey));
	const groups = splits.groups.filter(group => !group.members.some(member => keys.has(memberKey(member))));
	return groups.length === splits.groups.length ? splits : { ...splits, groups };
}

/** Remembers the split on screen as the page leaves it, in place of every group it shares a member with; a split with a pane whose conversation is still unknown is not remembered. */
function leave({ layout, splits }: PaneNavigation, hosts: RosterHost[]): SplitMemory {
	if (layout.panes.length < 2) return splits;
	const members = membersFor(layout, hosts);
	if (members.length !== layout.panes.length) return splits;
	return { ...splits, groups: [...withoutMembers(splits, members).groups, { members, ratios: splits.ratios }] };
}

/** `group`'s panes where they run now, focused on the member keyed `focus`, or `null` once any member is gone. Only live hosts count: a departed host's last row names the conversation, not where it can open. */
function restore(group: RememberedSplit, focus: string, hosts: RosterHost[]): Layout | null {
	const panes: View[] = [];
	for (const member of group.members) {
		if (member.kind === "session") {
			panes.push(viewForSession(member.sessionId, hosts));
			continue;
		}
		const host = hosts.find(row => row.sessionId === member.sessionId);
		if (!host?.agents.some(agent => agent.id === member.agentId)) return null;
		panes.push({ kind: "live", instanceId: host.instanceId, agentId: member.agentId });
	}
	return { panes, focus: group.members.findIndex(member => memberKey(member) === focus), maximized: false };
}

/** An explicit pane edit forgets every group that shares a member with the panes before or after it. */
function edit(state: PaneNavigation, layout: Layout, hosts: RosterHost[]): PaneNavigation {
	if (state.layout.panes.length === layout.panes.length && state.layout.panes.every((view, index) => sameView(view, layout.panes[index] ?? null))) return { layout, splits: state.splits };
	return { layout, splits: withoutMembers(state.splits, [...membersFor(state.layout, hosts), ...membersFor(layout, hosts)]) };
}

/** Selection memory never changes the meaning of an explicit layout or browser-history entry. */
export function changePanes(state: PaneNavigation, command: PaneCommand, hosts: RosterHost[], lastHosts: ReadonlyMap<string, RosterHost>): PaneNavigation {
	const { layout, splits } = state;
	switch (command.kind) {
		case "select": {
			if (command.mode === "split") return edit(state, openView(layout, command.view, "split"), knownHosts(hosts, lastHosts));
			const active = layout.panes.findIndex(view => sameView(view, command.view));
			if (active >= 0) return { layout: { ...layout, focus: active, maximized: false }, splits };
			const known = knownHosts(hosts, lastHosts);
			const left = leave(state, known);
			const single: Layout = { panes: [command.view], focus: 0, maximized: false };
			const member = memberFor(command.view, known);
			if (!member) return { layout: single, splits: left };
			const key = memberKey(member);
			const group = left.groups.find(candidate => candidate.members.some(other => memberKey(other) === key));
			if (!group) return { layout: single, splits: left };
			const restored = restore(group, key, hosts);
			if (restored) return { layout: restored, splits: { ...left, ratios: group.ratios } };
			return { layout: single, splits: { ...left, groups: left.groups.filter(candidate => candidate !== group) } };
		}
		case "edit":
			return edit(state, command.layout, knownHosts(hosts, lastHosts));
		case "history": {
			if (layout.panes.length === command.layout.panes.length && layout.panes.every((view, index) => sameView(view, command.layout.panes[index] ?? null))) return { layout: command.layout, splits };
			const known = knownHosts(hosts, lastHosts);
			const left = leave(state, known);
			const keys = membersFor(command.layout, known).map(memberKey);
			const group = keys.length === command.layout.panes.length ? left.groups.find(candidate => candidate.members.length === keys.length && candidate.members.every((member, index) => memberKey(member) === keys[index])) : undefined;
			return { layout: command.layout, splits: group ? { ...left, ratios: group.ratios } : left };
		}
		case "close": {
			const view = layout.panes[command.index];
			if (!view) return state;
			const member = memberFor(view, knownHosts(hosts, lastHosts));
			return { layout: closePane(layout, command.index), splits: member ? withoutMembers(splits, [member]) : splits };
		}
		case "resize":
			if (splits.ratios[command.axis] === command.ratio) return state;
			return { layout, splits: { ...splits, ratios: { ...splits.ratios, [command.axis]: command.ratio } } };
		case "forget-session": {
			const groups = splits.groups.filter(group => !group.members.some(member => member.sessionId === command.sessionId));
			return { layout, splits: groups.length === splits.groups.length ? splits : { ...splits, groups } };
		}
	}
}
