import type { RosterHost, View } from "../src/shared/sessions";
import { closePane, type Layout, type OpenMode, openView, sameView, viewForSession } from "./routing";

export type SplitAxis = "columns" | "rows";
export type SplitRatios = Readonly<Record<SplitAxis, number>>;
export const DEFAULT_SPLIT_RATIOS: SplitRatios = { columns: 0.5, rows: 0.5 };

type SplitMember = { kind: "session"; sessionId: string } | { kind: "agent"; sessionId: string; agentId: string };
type SplitMembers = readonly [SplitMember, SplitMember, ...SplitMember[]];
interface RememberedSplit {
	members: SplitMembers;
	ratios: SplitRatios;
}

export interface PaneNavigation {
	layout: Layout;
	splitRatios: SplitRatios;
	splitGroups: readonly RememberedSplit[];
	/** The visible split still needs source facts before it can be remembered. */
	splitPending: boolean;
}

export type PaneCommand =
	| { kind: "select"; view: View; mode: OpenMode }
	| { kind: "edit"; layout: Layout }
	| { kind: "history"; layout: Layout }
	| { kind: "close"; index: number }
	| { kind: "resize"; axis: SplitAxis; ratio: number }
	| { kind: "sources" }
	| { kind: "forget-session"; sessionId: string };

function memberFor(view: View, hosts: RosterHost[]): SplitMember | null {
	if (view.kind === "past") return { kind: "session", sessionId: view.sessionId };
	const host = hosts.find(row => row.instanceId === view.instanceId);
	if (!host?.sessionId) return null;
	return view.agentId === null ? { kind: "session", sessionId: host.sessionId } : { kind: "agent", sessionId: host.sessionId, agentId: view.agentId };
}

const sameMember = (a: SplitMember, b: SplitMember): boolean => a.sessionId === b.sessionId && a.kind === b.kind && (a.kind === "session" || (b.kind === "agent" && a.agentId === b.agentId));
const intersects = (group: RememberedSplit, members: readonly SplitMember[]): boolean => group.members.some(member => members.some(other => sameMember(member, other)));

function membersFor(layout: Layout, hosts: RosterHost[]): SplitMember[] {
	return layout.panes.flatMap(view => {
		const member = memberFor(view, hosts);
		return member ? [member] : [];
	});
}

function remember(state: PaneNavigation, hosts: RosterHost[]): PaneNavigation {
	if (state.layout.panes.length < 2) return { ...state, splitPending: false };
	const members = membersFor(state.layout, hosts);
	if (members.length !== state.layout.panes.length) return { ...state, splitPending: true };
	const [first, second, ...rest] = members;
	if (!first || !second) return state;
	const existing = state.splitGroups.find(group => group.members.length === members.length && group.members.every((member, index) => sameMember(member, members[index]!)));
	if (existing?.ratios === state.splitRatios) return state.splitPending ? { ...state, splitPending: false } : state;
	return {
		...state,
		splitPending: false,
		splitGroups: [...state.splitGroups.filter(group => !intersects(group, members)), { members: [first, second, ...rest], ratios: state.splitRatios }],
	};
}

function resolve(member: SplitMember, hosts: RosterHost[]): View | null {
	if (member.kind === "session") return viewForSession(member.sessionId, hosts);
	const host = hosts.find(row => row.sessionId === member.sessionId);
	return host?.agents.some(agent => agent.id === member.agentId) ? { kind: "live", instanceId: host.instanceId, agentId: member.agentId } : null;
}

function edit(state: PaneNavigation, layout: Layout, hosts: RosterHost[]): PaneNavigation {
	if (state.layout.panes.length === layout.panes.length && state.layout.panes.every((view, index) => sameView(view, layout.panes[index] ?? null))) return { ...state, layout };
	const touched = [...membersFor(state.layout, hosts), ...membersFor(layout, hosts)];
	return remember({ ...state, layout, splitGroups: state.splitGroups.filter(group => !intersects(group, touched)) }, hosts);
}

/** Selection memory never changes the meaning of an explicit layout or browser-history entry. */
export function changePanes(state: PaneNavigation, command: PaneCommand, hosts: RosterHost[], lastHosts: ReadonlyMap<string, RosterHost>): PaneNavigation {
	if (command.kind === "sources" && !state.splitPending) return state;
	const departed = [...lastHosts.values()].filter(host => !hosts.some(current => current.instanceId === host.instanceId));
	const knownHosts = departed.length > 0 ? [...hosts, ...departed] : hosts;
	switch (command.kind) {
		case "select": {
			if (command.mode === "split") return edit(state, openView(state.layout, command.view, "split"), knownHosts);
			const member = memberFor(command.view, knownHosts);
			const active = state.layout.panes.findIndex(view => sameView(view, command.view));
			const group = member && state.splitGroups.find(candidate => candidate.members.some(other => sameMember(member, other)));
			if (group && member) {
				const panes = group.members.map(saved => resolve(saved, hosts));
				if (panes.every((view): view is View => view !== null)) {
					if (active >= 0) return { ...state, layout: { ...state.layout, focus: active, maximized: false } };
					return { ...state, layout: { panes, focus: group.members.findIndex(other => sameMember(member, other)), maximized: false }, splitRatios: group.ratios, splitPending: false };
				}
				state = { ...state, splitGroups: state.splitGroups.filter(candidate => candidate !== group) };
				return { ...state, layout: { panes: [command.view], focus: 0, maximized: false }, splitPending: false };
			}
			if (active >= 0) return { ...state, layout: { ...state.layout, focus: active, maximized: false } };
			return { ...state, layout: { panes: [command.view], focus: 0, maximized: false }, splitPending: false };
		}
		case "edit":
			return edit(state, command.layout, knownHosts);
		case "history": {
			const members = membersFor(command.layout, knownHosts);
			const group = members.length === command.layout.panes.length && state.splitGroups.find(candidate => candidate.members.length === members.length && candidate.members.every((member, index) => sameMember(member, members[index]!)));
			return remember({ ...state, layout: command.layout, splitRatios: group ? group.ratios : state.splitRatios }, knownHosts);
		}
		case "close": {
			const view = state.layout.panes[command.index];
			if (!view) return state;
			const member = memberFor(view, knownHosts);
			const splitGroups = member ? state.splitGroups.filter(group => !intersects(group, [member])) : state.splitGroups;
			return remember({ ...state, splitGroups, layout: closePane(state.layout, command.index) }, knownHosts);
		}
		case "resize":
			if (state.splitRatios[command.axis] === command.ratio) return state;
			return remember({ ...state, splitRatios: { ...state.splitRatios, [command.axis]: command.ratio } }, knownHosts);
		case "sources":
			return remember(state, knownHosts);
		case "forget-session":
			return { ...state, splitGroups: state.splitGroups.filter(group => !group.members.some(member => member.sessionId === command.sessionId)), splitPending: false };
	}
}
