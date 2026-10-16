import { describe, expect, test } from "bun:test";
import type { LinkedPullRequest, PullRequestDetail } from "../shared/github";
import type { Project } from "../shared/projects";
import type { Ticket } from "../shared/tickets";
import { matchesFilter, ProjectWatch } from "./project-watch";

const AT = "2026-10-10T08:00:00.000Z";
const PR: LinkedPullRequest = { owner: "o", repo: "r", number: 12 } as LinkedPullRequest;

function project(overrides: Partial<Project> = {}): Project {
	return {
		id: "p1",
		name: "Billing",
		cwd: "/work/app",
		createdAt: AT,
		archived: false,
		coordinator: { sessionId: "s-c" },
		workers: [{ id: "w1", title: "Schema", sessionId: "s-w1", cwd: "/work/app", startedAt: AT, lastReply: null }],
		updates: [],
		nextWorker: 2,
		maxWorkers: 3,
		queue: [],
		watch: { pullRequests: true, linear: null },
		reviewCadence: "every PR",
		...overrides,
	};
}

/** The parts of a pull request the watch reads. */
function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
	return { ...PR, title: "Rename X", state: "open", checks: "pending", checkRuns: [], conversation: [], ...overrides } as PullRequestDetail;
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return { id: "ENG-1", title: "Bug", url: "https://linear.app/x/ENG-1", status: "Todo", team: "ENG", project: "Billing", labels: [{ name: "bug" }], updatedAt: AT, ...overrides } as Ticket;
}

function harness(projects: Project[]) {
	const state = {
		detail: detail(),
		/** Each pull request's detail by number, else `detail`. */
		details: new Map<number, PullRequestDetail>(),
		pullRequests: [PR],
		tickets: [] as Ticket[],
		notified: [] as string[],
		reads: 0,
		/** Whether `endIdle` finds the worker idle. */
		idle: true,
		ended: [] as string[],
	};
	const watch = new ProjectWatch({
		projects: () => projects,
		pullRequestsOf: sessionId => (sessionId === "s-w1" ? state.pullRequests : []),
		detail: async pr => {
			state.reads++;
			return state.details.get(pr.number) ?? state.detail;
		},
		tickets: async () => state.tickets,
		notify(projectId, event) {
			state.notified.push(`${projectId} ${event.source}: ${event.title}${event.text ? ` | ${event.text}` : ""}`);
			return null;
		},
		endIdle(projectId, workerId) {
			if (state.idle) state.ended.push(`${projectId} ${workerId}`);
			return state.idle;
		},
	});
	/** Two minutes pass, which takes one look. */
	const look = async () => {
		await watch.tick();
		await watch.tick();
	};
	return { watch, state, look };
}

describe("ProjectWatch", () => {
	test("a worker's pull request reports failing checks, new comments and reviews, and its merge, after a first silent look", async () => {
		const { state, look } = harness([project()]);
		await look();
		expect(state.notified).toEqual([]);
		state.detail = detail({
			checks: "failing",
			checkRuns: [{ name: "lint", state: "failing", url: null }, { name: "test", state: "passing", url: null }],
			conversation: [{ author: { login: "ana", avatarUrl: null }, body: "Rename Y too.", at: 5, url: null, review: "changes-requested" }],
		});
		await look();
		state.detail = detail({ state: "merged", checks: "passing", conversation: state.detail.conversation });
		await look();
		expect(state.notified).toEqual([
			"p1 GitHub: Checks failed on o/r#12 | Failing: lint",
			"p1 GitHub: ana requested changes on o/r#12 | Rename Y too.",
			'p1 GitHub: o/r#12 was merged | Rename X\nEnded w1 "Schema": idle, with every pull request merged or closed.',
			"p1 GitHub: Checks pass again on o/r#12 | Rename X",
		]);
		expect(state.ended).toEqual(["p1 w1"]);
		await look();
		expect(state.reads).toBe(3);
		expect(state.ended).toEqual(["p1 w1"]);
	});

	test("a merge leaves a worker that is not idle, or has another pull request open, and a merge seen at the first look ends none", async () => {
		const busy = harness([project()]);
		busy.state.idle = false;
		await busy.look();
		busy.state.detail = detail({ state: "merged" });
		await busy.look();
		expect(busy.state.notified).toEqual(["p1 GitHub: o/r#12 was merged | Rename X"]);

		const open = harness([project()]);
		const other = { owner: "o", repo: "r", number: 13 } as LinkedPullRequest;
		open.state.pullRequests = [PR, other];
		open.state.details.set(13, detail({ number: 13, title: "Follow-up" }));
		await open.look();
		open.state.detail = detail({ state: "merged" });
		await open.look();
		expect(open.state.ended).toEqual([]);

		const late = harness([project()]);
		late.state.detail = detail({ state: "merged" });
		await late.look();
		await late.look();
		expect(late.state.ended).toEqual([]);
	});

	test("one minute alone takes no look", async () => {
		const { watch, state } = harness([project()]);
		await watch.tick();
		expect(state.reads).toBe(0);
		await watch.tick();
		expect(state.reads).toBe(1);
	});

	test("a project that does not watch pull requests, or is archived, reads none", async () => {
		const { state, look } = harness([project({ watch: { pullRequests: false, linear: null } }), project({ id: "p2", archived: true })]);
		await look();
		expect(state.reads).toBe(0);
	});

	test("Linear issues matching the filter report when new or changed, after a first silent look", async () => {
		const { state, look } = harness([project({ watch: { pullRequests: false, linear: { team: "eng", label: "Bug", project: null } } })]);
		state.tickets = [ticket()];
		await look();
		state.tickets = [ticket({ updatedAt: "2026-10-11T08:00:00.000Z", status: "In Progress" }), ticket({ id: "ENG-2", title: "Crash" }), ticket({ id: "OPS-3", team: "OPS" })];
		await look();
		expect(state.notified).toEqual(["p1 Linear: ENG-1 changed: Bug | Status: In Progress", "p1 Linear: New Linear issue ENG-2: Crash | Status: Todo"]);
	});

	test("a filter field matches any value when null, and names case aside", () => {
		expect(matchesFilter(ticket(), { team: null, label: null, project: null })).toBe(true);
		expect(matchesFilter(ticket(), { team: "ENG", label: "BUG", project: "billing" })).toBe(true);
		expect(matchesFilter(ticket({ project: null }), { team: null, label: null, project: "Billing" })).toBe(false);
	});
});
