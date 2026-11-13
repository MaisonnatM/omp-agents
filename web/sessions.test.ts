import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, test } from "bun:test";
import type { ScheduledSend } from "../src/shared/scheduled";
import type { AgentRow, AgentStatus, HostStatus, PastSession, RosterHost, UnreadTurn, View } from "../src/shared/sessions";
import { spaces } from "../src/shared/workspaces";
import type { Layout, Page } from "./routing";
import { defaultCwd, discoverableSessions, latestSession, listedViews, listWorkspaces, rosterFolders, rowPlacement, scheduledIn, searchSessions, sessionsIn, sidebarSessions, spaceSession, spaceSwitchPanes, waitingCount, waitingIn, workspaceGroups, workspaceSession, workspacesIn, workspaceSwitch } from "./sessions";

const host = (sessionId: string, cwd: string) => fromPartial<RosterHost>({ instanceId: `i-${sessionId}`, sessionId, cwd, agents: [], turnWaits: false });
const subagents = (...statuses: AgentStatus[]): AgentRow[] => statuses.map(status => fromPartial<AgentRow>({ status }));
const past = (sessionId: string, cwd: string, interrupted: boolean) => ({ sessionId, cwd, interrupted }) as PastSession;
const ids = (rows: { sessionId: string }[]) => rows.map(row => row.sessionId);
const none = new Set<string>();
const noBots = new Set<string>();

describe("discoverableSessions", () => {
	test("hides temporary roots and descendants but keeps lookalikes and directories named tmp elsewhere", () => {
		const paths = [
			"/tmp",
			"/tmp/",
			"/tmp/build",
			"/tmp/build/nested/",
			"/private/tmp",
			"/private/tmp/",
			"/private/tmp/build",
			"/private/tmp/build/nested/",
			"/tmp-workspace",
			"/private/tmp-workspace",
			"/home/user/tmp",
			"/home/user/tmp/workspace/",
			"",
		];
		const hosts = paths.map((cwd, index) => host(`h${index}`, cwd));
		const sessions = paths.map((cwd, index) => past(`p${index}`, cwd, index % 2 === 0));
		const visible = discoverableSessions(hosts, sessions, none, noBots);
		expect(visible.hosts.map(row => row.cwd)).toEqual(["/tmp-workspace", "/private/tmp-workspace", "/home/user/tmp", "/home/user/tmp/workspace/", ""]);
		expect(visible.past.map(row => row.cwd)).toEqual(["/tmp-workspace", "/private/tmp-workspace", "/home/user/tmp", "/home/user/tmp/workspace/", ""]);
	});

	test("a hidden workspace hides its own sessions, not those of the directories inside it", () => {
		const hosts = [host("a", "/home/user/app"), host("b", "/home/user/app/web"), host("c", "/home/user/other")];
		expect(discoverableSessions(hosts, [], new Set(["/home/user/app"]), noBots).hosts.map(row => row.cwd)).toEqual(["/home/user/app/web", "/home/user/other"]);
		expect(workspaceSwitch("/home/user/other", "/home/user/app", new Set(["/home/user/app"]))).toBeNull();
	});

	test("a Bot's conversation leaves the session lists, live or past", () => {
		const visible = discoverableSessions([host("bot", "/w"), host("mine", "/w")], [past("bot", "/w", false), past("old", "/w", false)], none, new Set(["bot"]));
		expect(ids(visible.hosts)).toEqual(["mine"]);
		expect(ids(visible.past)).toEqual(["old"]);
	});

	test("hidden sessions stay out of pinned and interrupted lists without losing saved rows", () => {
		const hosts = [host("hidden-live", "/tmp/job"), host("pinned-live", "~/workspace"), host("running", "~/workspace")];
		const sessions = [
			past("hidden-interrupted", "/private/tmp/job", true),
			past("hidden-ended", "/tmp/", false),
			past("pinned-interrupted", "~/workspace", true),
			past("pinned-ended", "~/workspace", false),
			past("interrupted", "~/workspace", true),
			past("ended", "~/workspace", false),
		];
		const visible = discoverableSessions(hosts, sessions, none, noBots);
		const lists = sidebarSessions(
			visible.hosts,
			visible.past,
			null,
			new Set(["hidden-live", "hidden-interrupted", "hidden-ended", "pinned-live", "pinned-ended", "pinned-interrupted"]),
		);
		expect(ids(lists.pinned.hosts)).toEqual(["pinned-live"]);
		expect(ids(lists.pinned.past)).toEqual(["pinned-interrupted", "pinned-ended"]);
		expect(ids(lists.running)).toEqual(["running"]);
		expect(ids(lists.interrupted)).toEqual(["interrupted"]);
		expect(ids(lists.ended)).toEqual(["ended"]);
		expect(ids(hosts)).toEqual(["hidden-live", "pinned-live", "running"]);
		expect(ids(sessions)).toEqual(["hidden-interrupted", "hidden-ended", "pinned-interrupted", "pinned-ended", "interrupted", "ended"]);
		expect(visible.hosts[0]).toBe(hosts[1]);
		expect(visible.past[0]).toBe(sessions[2]);
	});

	test("a temp cwd is not a workspace switch", () => {
		for (const cwd of ["/tmp", "/tmp/", "/tmp/job", "/private/tmp", "/private/tmp/", "/private/tmp/job", "/var/folders/wj/x/T/tmp.a", "/private/var/folders/wj/x/T/tmp.a"]) {
			expect(workspaceSwitch("~/app", cwd, none)).toBeNull();
		}
		expect(workspaceSwitch("~/app", "/tmp-workspace", none)).toBe("/tmp-workspace");
		expect(workspaceSwitch("~/app", "/var/foldersx", none)).toBe("/var/foldersx");
		expect(workspaceSwitch("~/app", "~/other", none)).toBe("~/other");
		expect(workspaceSwitch(null, "~/other", none)).toBeNull();
		expect(workspaceSwitch("~/app", "~/app", none)).toBeNull();
	});
});

describe("workspaceSession", () => {
	const running = (instanceId: string, cwd: string, startedAt: number) => ({ instanceId, cwd, startedAt }) as RosterHost;
	const hosts = [running("old", "~/app", 1), running("new", "~/app", 3), running("other", "~/other", 5)];

	test("opens the workspace's most recently started running session", () => {
		expect(workspaceSession("~/app", hosts, "~/other")).toEqual({ kind: "live", instanceId: "new", agentId: null });
		expect(workspaceSession("~/app", hosts, undefined)).toEqual({ kind: "live", instanceId: "new", agentId: null });
	});

	test("opens nothing for All workspaces, a pane already in the workspace, or a workspace with no running session", () => {
		expect(workspaceSession(null, hosts, "~/other")).toBeNull();
		expect(workspaceSession("~/app", hosts, "~/app")).toBeNull();
		expect(workspaceSession("~/idle", hosts, "~/other")).toBeNull();
	});
});

describe("spaces", () => {
	const personalDir = { cwd: "/home/me/personal", cwdDisplay: "~/personal" };
	const placed = spaces(["/code/garden"], personalDir);
	const running = (sessionId: string, cwd: string, startedAt: number, workspace: string | null = null) =>
		fromPartial<RosterHost>({ ...host(sessionId, cwd), startedAt, workspace: workspace === null ? null : { cwd: workspace, cwdDisplay: workspace } });

	test("a session counts in the space of its workspace, the personal directory and a linked worktree of a Personal workspace in Personal", () => {
		const hosts = [running("life", "/home/me/personal", 1), running("tree", "/code/garden-wt", 2, "/code/garden"), running("job", "/code/app", 3), running("unplaced", "/code/garden", 4)];
		const lists = { hosts, past: [past("old", "/code/garden", false), past("work", "/code/app", false)] };
		expect(ids(sessionsIn(lists, "personal", placed).hosts)).toEqual(["life", "tree", "unplaced"]);
		expect(ids(sessionsIn(lists, "personal", placed).past)).toEqual(["old"]);
		expect(ids(sessionsIn(lists, "work", placed).hosts)).toEqual(["job"]);
	});

	test("before the server names the personal directory, a session there counts as Work", () => {
		const lists = { hosts: [running("life", "/home/me/personal", 1)], past: [] };
		const unnamed = spaces(["/code/garden"], null);
		expect(ids(sessionsIn(lists, "work", unnamed).hosts)).toEqual(["life"]);
		expect(sessionsIn(lists, "personal", unnamed).hosts).toEqual([]);
	});

	test("Personal's workspaces start at the personal directory, even before a session ran there", () => {
		const workspaces = [{ cwd: "/code/app", cwdDisplay: "~/app" }, { cwd: "/code/garden", cwdDisplay: "~/garden" }, personalDir];
		expect(workspacesIn(workspaces, "personal", placed, personalDir)).toEqual([personalDir, { cwd: "/code/garden", cwdDisplay: "~/garden" }]);
		expect(workspacesIn(workspaces.slice(0, 2), "personal", placed, personalDir)).toEqual([personalDir, { cwd: "/code/garden", cwdDisplay: "~/garden" }]);
		expect(workspacesIn(workspaces, "work", placed, personalDir)).toEqual([{ cwd: "/code/app", cwdDisplay: "~/app" }]);
	});

	test("switching space follows the space's most recently started running session, or nothing when none runs there", () => {
		const hosts = [running("old", "/code/garden", 1), running("new", "/home/me/personal", 5), running("job", "/code/app", 9)];
		expect(spaceSession("personal", hosts, placed)).toEqual({ kind: "live", instanceId: "i-new", agentId: null });
		expect(spaceSession("work", hosts, placed)).toEqual({ kind: "live", instanceId: "i-job", agentId: null });
		expect(spaceSession("personal", [running("job", "/code/app", 9)], placed)).toBeNull();
	});

	test("a scheduled start is in its directory's space, a message or a continue in its session's, and one for a session no list holds in Work", () => {
		const byPage = spaces([{ cwd: "/code/garden", cwdDisplay: "~/garden" }], personalDir);
		const send = (id: string, target: ScheduledSend["target"]) => fromPartial<ScheduledSend>({ id, target });
		const sends = [
			send("home", fromPartial({ kind: "start", request: { cwd: "~/personal" } })),
			send("garden", fromPartial({ kind: "start", request: { cwd: "~/garden" } })),
			send("job", fromPartial({ kind: "start", request: { cwd: "~/app" } })),
			send("life", { kind: "message", sessionId: "life", text: "hi" }),
			send("old", { kind: "continue", sessionId: "old", provider: "Anthropic", cause: "usage-limit" }),
			send("gone", { kind: "message", sessionId: "gone", text: "hi" }),
		];
		const sessions = { hosts: [running("life", "/code/garden-wt", 1, "/code/garden")], past: [past("old", "/home/me/personal", false)] };
		expect(scheduledIn(sends, "personal", sessions, byPage).map(({ id }) => id)).toEqual(["home", "garden", "life", "old"]);
		expect(scheduledIn(sends, "work", sessions, byPage).map(({ id }) => id)).toEqual(["job", "gone"]);
	});

	test("a space counts the sessions it lists that need you, not those of a hidden workspace or a Bot", () => {
		const turn = fromPartial<UnreadTurn>({ at: 1, reply: "Done." });
		const asks = (sessionId: string, cwd: string) => ({ ...running(sessionId, cwd, 1), status: "needs-input" as const, unread: null, requests: [] });
		const hosts = [
			asks("life", "/home/me/personal"),
			{ ...running("garden", "/code/garden", 2), status: "idle" as const, unread: turn, requests: [] },
			asks("secret", "/home/me/personal/hidden"),
			asks("bot", "/home/me/personal"),
			asks("job", "/code/app"),
			{ ...running("busy", "/code/app", 3), status: "working" as const, unread: null, requests: [] },
		];
		const everySpace = discoverableSessions(hosts, [], new Set(["/home/me/personal/hidden"]), new Set(["bot"]));
		expect(waitingIn(everySpace, "personal", placed)).toBe(2);
		expect(waitingIn(everySpace, "work", placed)).toBe(1);
	});

	test("a switch of space keeps a page of both spaces, and otherwise opens the newest session of the space it goes to", () => {
		const hosts = [running("life", "/home/me/personal", 5), running("job", "/code/app", 9)];
		const panes = fromPartial<Layout>({ panes: [{}] });
		const empty = fromPartial<Layout>({ panes: [] });
		const sport: Page = { kind: "sport", tab: "week", day: null };
		const todo: Page = { kind: "todo", list: { kind: "all" }, open: null };
		expect(spaceSwitchPanes(todo, panes, "work", "personal", hosts, placed)).toBe("stay");
		expect(spaceSwitchPanes(sport, panes, "work", "personal", hosts, placed)).toBe("stay");
		expect(spaceSwitchPanes(null, panes, "work", "personal", hosts, placed)).toEqual({ kind: "live", instanceId: "i-life", agentId: null });
		expect(spaceSwitchPanes(sport, panes, "personal", "work", hosts, placed)).toEqual({ kind: "live", instanceId: "i-job", agentId: null });
		expect(spaceSwitchPanes(null, panes, "personal", "work", [hosts[0]!], placed)).toBe("empty");
		expect(spaceSwitchPanes(sport, empty, "personal", "work", hosts, placed)).toBe("empty");
		expect(spaceSwitchPanes(null, empty, "work", "personal", hosts, placed)).toBe("empty");
	});
});

describe("latestSession", () => {
	const running = (sessionId: string, cwd: string, startedAt: number) => ({ ...host(sessionId, cwd), startedAt }) as RosterHost;
	const saved = (sessionId: string, cwd: string, modifiedAt: number) => ({ ...past(sessionId, cwd, false), modifiedAt }) as PastSession;
	const latestIn = (hosts: RosterHost[], sessions: PastSession[]) => latestSession(sidebarSessions(hosts, sessions, "~/app", none));
	const sessions = [saved("older", "~/app", 10), saved("newer", "~/app", 30), saved("elsewhere", "~/other", 50)];

	test("opens the workspace's live session started last, even when a past one or another workspace's session is newer", () => {
		const hosts = [running("first", "~/app", 1), running("last", "~/app", 3), running("other", "~/other", 9)];
		expect(latestIn(hosts, sessions)).toEqual({ kind: "live", instanceId: "i-last", agentId: null });
	});

	test("opens the workspace's past session saved last when none is live there, and nothing when it has no session", () => {
		expect(latestIn([running("other", "~/other", 9)], sessions)).toEqual({ kind: "past", sessionId: "newer" });
		expect(latestIn([], [saved("elsewhere", "~/other", 50)])).toBeNull();
	});
});

describe("defaultCwd", () => {
	const host = (instanceId: string, cwdDisplay: string, startedAt: number) => ({ instanceId, cwd: cwdDisplay, cwdDisplay, startedAt }) as RosterHost;
	const past = (sessionId: string, cwdDisplay: string) => ({ sessionId, cwd: cwdDisplay, cwdDisplay }) as PastSession;
	const hosts = [host("a", "~/old", 1), host("b", "~/new", 2)];
	const sessions = [past("s1", ""), past("s2", "~/saved")];
	const all = { workspace: null, home: null };
	const personal = { cwd: "/home/me/personal", cwdDisplay: "~/personal" };

	test("prefers the open session, then the newest live one, then the newest past one with a directory", () => {
		expect(defaultCwd({ kind: "live", instanceId: "a", agentId: null }, hosts, sessions, all)).toBe("~/old");
		expect(defaultCwd({ kind: "past", sessionId: "s2" }, hosts, sessions, all)).toBe("~/saved");
		expect(defaultCwd(null, hosts, sessions, all)).toBe("~/new");
		expect(defaultCwd({ kind: "past", sessionId: "s1" }, [], sessions, all)).toBe("~/saved");
		expect(defaultCwd(null, [], [], all)).toBe("~");
	});

	test("stays in the selected workspace, so the new session is listed under it", () => {
		expect(defaultCwd({ kind: "live", instanceId: "b", agentId: null }, hosts, sessions, { workspace: "~/old", home: null })).toBe("~/old");
		expect(defaultCwd(null, hosts, sessions, { workspace: "~/saved", home: null })).toBe("~/saved");
	});

	test("in Personal with no workspace picked, starts in the personal directory whatever session is open", () => {
		expect(defaultCwd({ kind: "live", instanceId: "a", agentId: null }, hosts, sessions, { workspace: null, home: personal })).toBe("~/personal");
		expect(defaultCwd(null, hosts, sessions, { workspace: "~/saved", home: personal })).toBe("~/saved");
	});
});

describe("sidebarSessions", () => {
	const hosts = [host("h1", "~/a"), host("h2", "~/a"), host("h3", "~/b")];
	const sessions = [past("p1", "~/a", false), past("p2", "~/a", true), past("p3", "~/a", false), past("p4", "~/b", true)];

	test("a pinned session leaves its own list, and pinned past sessions list interrupted ones first", () => {
		const lists = sidebarSessions(hosts, sessions, null, new Set(["h2", "p1", "p4"]));
		expect(ids(lists.pinned.hosts)).toEqual(["h2"]);
		expect(ids(lists.pinned.past)).toEqual(["p4", "p1"]);
		expect(ids(lists.running)).toEqual(["h1", "h3"]);
		expect(ids(lists.interrupted)).toEqual(["p2"]);
		expect(ids(lists.ended)).toEqual(["p3"]);
	});

	test("a pinned session from another workspace stays out of the selected workspace's lists", () => {
		const lists = sidebarSessions(hosts, sessions, "~/a", new Set(["h3", "p4", "p3"]));
		expect(ids(lists.pinned.hosts)).toEqual([]);
		expect(ids(lists.pinned.past)).toEqual(["p3"]);
		expect(ids(lists.running)).toEqual(["h1", "h2"]);
	});

	test("an idle session leaves running for its own list, a pinned one stays pinned, and a question keeps it running", () => {
		const statuses = { h1: "idle", h2: "needs-input", h3: "working", h4: "idle", h5: "unknown" } as const;
		const live = Object.entries(statuses).map(([id, status]) => ({ ...host(id, "~/a"), status }));
		const lists = sidebarSessions(live, [], null, new Set(["h4"]));
		expect(ids(lists.pinned.hosts)).toEqual(["h4"]);
		expect(ids(lists.running)).toEqual(["h2", "h3", "h5"]);
		expect(ids(lists.idle)).toEqual(["h1"]);
	});

	test("a session whose subagents still run while its main agent's turn ended or only waits on them lists as waiting on subagents", () => {
		const live = (sessionId: string, status: HostStatus, turnWaits: boolean, agents: AgentRow[]) => fromPartial<RosterHost>({ ...host(sessionId, "~/a"), status, turnWaits, agents });
		const lists = sidebarSessions(
			[
				live("idle-delegating", "idle", false, subagents("running")),
				live("waits-on-subagent", "working", true, subagents("idle", "running")),
				live("waits-on-bash-job", "working", true, []),
				live("works-beside-subagent", "working", false, subagents("running")),
				live("done", "idle", false, subagents("idle", "aborted")),
				live("asks", "needs-input", true, subagents("running")),
				live("pinned", "idle", false, subagents("running")),
			],
			[],
			null,
			new Set(["pinned"]),
		);
		expect(ids(lists.awaitingSubagents)).toEqual(["idle-delegating", "waits-on-subagent"]);
		expect(ids(lists.running)).toEqual(["waits-on-bash-job", "works-beside-subagent", "asks"]);
		expect(ids(lists.idle)).toEqual(["done"]);
		expect(ids(lists.pinned.hosts)).toEqual(["pinned"]);
	});

	test("the waiting count takes unread turns and open questions in the selected workspace, pinned ones included, and not a turn already read or one whose session waits on its subagents", () => {
		const turn = fromPartial<UnreadTurn>({ at: 1, reply: "Done." });
		const rows = { h1: ["idle", turn], h2: ["needs-input", null], h3: ["working", null], h4: ["idle", turn], h5: ["unknown", null], h7: ["idle", null] } as const;
		const live = [
			...Object.entries(rows).map(([id, [status, unread]]) => ({ ...host(id, "~/a"), status, unread, requests: [] })),
			{ ...host("h6", "~/b"), status: "idle" as const, unread: turn, requests: [] },
			{ ...host("h8", "~/a"), status: "idle" as const, unread: turn, requests: [], agents: subagents("running") },
		];
		expect(waitingCount(sidebarSessions(live, [], "~/a", new Set(["h4"])))).toBe(3);
	});

	test("the previous and next session keys walk pinned rows first, then each workspace's idle, running, waiting on subagents, and interrupted rows, then past", () => {
		const delegating = fromPartial<RosterHost>({ ...host("h9", "~/a"), status: "idle", agents: subagents("running") });
		const live = [delegating, { ...host("h0", "~/a"), status: "idle" as const }, ...hosts];
		const lists = sidebarSessions(live, sessions, "~/a", new Set(["h2", "p3"]));
		expect(listedViews(lists, workspaceGroups(lists, []))).toEqual([
			{ kind: "live", instanceId: "i-h2", agentId: null },
			{ kind: "past", sessionId: "p3" },
			{ kind: "live", instanceId: "i-h0", agentId: null },
			{ kind: "live", instanceId: "i-h1", agentId: null },
			{ kind: "live", instanceId: "i-h9", agentId: null },
			{ kind: "past", sessionId: "p2" },
			{ kind: "past", sessionId: "p1" },
		]);
	});

	test("the roster groups live and interrupted sessions by workspace, busy workspaces first, each in the workspaces' order", () => {
		const workspace = (cwd: string) => ({ cwd, cwdDisplay: cwd });
		const live = [{ ...host("h1", "~/b"), status: "idle" as const }, { ...host("h2", "~/c"), status: "working" as const }];
		const lists = sidebarSessions(live, [past("p1", "~/a", true), past("p2", "~/a", false)], null, none);
		const groups = workspaceGroups(lists, [workspace("~/a"), workspace("~/quiet"), workspace("~/b")]);
		expect(groups.map(group => group.workspace.cwd)).toEqual(["~/a", "~/b", "~/c", "~/quiet"]);
		expect(groups.map(group => [ids(group.hosts), ids(group.interrupted)])).toEqual([[[], ["p1"]], [["h1"], []], [["h2"], []], [[], []]]);
		expect(listedViews(lists, groups)).toEqual([
			{ kind: "past", sessionId: "p1" },
			{ kind: "live", instanceId: "i-h1", agentId: null },
			{ kind: "live", instanceId: "i-h2", agentId: null },
			{ kind: "past", sessionId: "p2" },
		]);
	});

	test("the roster's workspace order stays put while a session's turn ends, though the idle sessions list first", () => {
		const workspaces = [{ cwd: "~/a", cwdDisplay: "~/a" }, { cwd: "~/b", cwdDisplay: "~/b" }];
		const order = (live: RosterHost[]) => workspaceGroups(sidebarSessions(live, [], null, none), workspaces).map(group => group.workspace.cwd);
		const working = [{ ...host("h1", "~/a"), status: "working" as const }, { ...host("h2", "~/b"), status: "working" as const }];
		expect(order(working)).toEqual(["~/a", "~/b"]);
		expect(order([working[0]!, { ...working[1]!, status: "idle" as const }])).toEqual(["~/a", "~/b"]);
		expect(order([{ ...working[0]!, status: "idle" as const }, working[1]!])).toEqual(["~/a", "~/b"]);
	});

	test("a search keeps the rows whose title or directory holds every word, in any order and any case, pinned ones included", () => {
		const titled = (row: RosterHost | PastSession, title: string | null, cwdDisplay: string) => ({ ...row, cwdDisplay, sessionName: title, title });
		const live = [titled(host("h1", "~/a"), "Fix login", "~/code/webapp"), titled(host("h2", "~/a"), "Fix billing", "~/code/api"), titled(host("h3", "~/b"), null, "~/code/webapp")] as RosterHost[];
		const saved = [titled(past("p1", "~/a", false), "Login copy", "~/code/webapp"), titled(past("p2", "~/a", false), "Login copy", "~/code/api")] as PastSession[];
		const lists = searchSessions(sidebarSessions(live, saved, null, new Set(["h2", "p1"])), "  WEBAPP login ");
		expect(ids(lists.running)).toEqual(["h1"]);
		expect(ids(lists.pinned.past)).toEqual(["p1"]);
		expect(ids([...lists.pinned.hosts, ...lists.ended])).toEqual([]);
		expect(ids(searchSessions(sidebarSessions(live, saved, "~/b", new Set()), "webapp").running)).toEqual(["h3"]);
	});
});

describe("a session in a linked worktree", () => {
	const app = { cwd: "/code/app", cwdDisplay: "~/code/app" };
	const inWorktree = fromPartial<RosterHost>({ instanceId: "i-w", sessionId: "w", cwd: "/code/app-fix", cwdDisplay: "~/code/app-fix", workspace: app, startedAt: 2, agents: [] });
	const inMain = fromPartial<RosterHost>({ instanceId: "i-m", sessionId: "m", cwd: "/code/app", cwdDisplay: "~/code/app", workspace: null, startedAt: 1, agents: [] });

	test("counts in its repository's workspace, which lists it, while its directory is no workspace", () => {
		expect(listWorkspaces([inWorktree], [], [])).toEqual([app]);
		expect(ids(sidebarSessions([inWorktree, inMain], [], "/code/app", new Set()).running)).toEqual(["w", "m"]);
		expect(defaultCwd({ kind: "live", instanceId: "i-w", agentId: null }, [inWorktree], [], { workspace: "/code/app", home: null })).toBe("~/code/app");
	});

	test("leaves the lists with its hidden workspace", () => {
		expect(ids(discoverableSessions([inWorktree, inMain], [], new Set(["/code/app"]), noBots).hosts)).toEqual([]);
	});
});

describe("rowPlacement", () => {
	const live = (instanceId: string, agentId: string | null = null): View => ({ kind: "live", instanceId, agentId });
	const saved: View = { kind: "past", sessionId: "s" };

	test("a session shown alone is alone, and one off screen is hidden", () => {
		expect(rowPlacement([live("a")], live("a"))).toBe("alone");
		expect(rowPlacement([live("a")], live("b"))).toBe("hidden");
		expect(rowPlacement([saved], saved)).toBe("alone");
		expect(rowPlacement([], saved)).toBe("hidden");
	});

	test("a session sharing the screen with another pane is in a split", () => {
		expect(rowPlacement([live("a"), saved], live("a"))).toBe("split");
		expect(rowPlacement([live("a"), saved], saved)).toBe("split");
		expect(rowPlacement([live("a"), saved], live("b"))).toBe("hidden");
	});

	test("a pane of one of its subagents shows the session", () => {
		expect(rowPlacement([live("a", "explore")], live("a"))).toBe("alone");
		expect(rowPlacement([live("a"), live("a", "explore")], live("a"))).toBe("split");
		expect(rowPlacement([live("b"), live("a", "explore")], live("a"))).toBe("split");
	});

	test("a past session with the same id as a live instance is not confused with it", () => {
		expect(rowPlacement([live("s")], saved)).toBe("hidden");
	});
});

describe("rosterFolders", () => {
	const workspace = (cwd: string) => ({ cwd, cwdDisplay: cwd });
	const groups = workspaceGroups(sidebarSessions([host("h1", "~/c")], [], null, none), ["~/a", "~/b", "~/c", "~/d"].map(workspace));
	const cwds = ({ shown }: { shown: { group: { workspace: { cwd: string } } }[] }) => shown.map(({ group }) => group.workspace.cwd);
	const options = { limit: 2, all: false, filtering: false };

	test("busy folders come first and the rest stay behind the limit", () => {
		const folders = rosterFolders(groups, options);
		expect(cwds(folders)).toEqual(["~/c", "~/a"]);
		expect(folders.more).toBe(2);
	});

	test("the full list folds back only when more folders match than the limit", () => {
		expect(rosterFolders(groups, { ...options, all: true }).foldable).toBe(true);
		expect(rosterFolders(groups, { ...options, all: true, limit: 4 }).foldable).toBe(false);
		expect(rosterFolders(groups, { ...options, all: true, filtering: true }).foldable).toBe(false);
	});
});
