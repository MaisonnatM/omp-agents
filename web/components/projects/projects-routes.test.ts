import { expect, test } from "bun:test";
import { hashForNewSession, hashForProject, routeFromHash } from "../../routing";

test("project routes list every project or open one, and round-trip", () => {
	expect(hashForProject(null)).toBe("#projects");
	expect(routeFromHash("#projects")).toEqual({ kind: "page", page: { kind: "projects", open: null } });
	expect(hashForProject("p 1")).toBe("#projects/p%201");
	expect(routeFromHash("#projects/p%201")).toEqual({ kind: "page", page: { kind: "projects", open: "p 1" } });
});

test("a new session's address names the project it joins as it starts", () => {
	expect(hashForNewSession({ projectId: "p1" })).toBe("#new?project=p1");
	expect(routeFromHash("#new?project=p1")).toEqual({ kind: "page", page: { kind: "new", cwd: null, projectId: "p1" } });
	expect(hashForNewSession({ cwd: "~/code", projectId: "p1" })).toBe("#new/~%2Fcode?project=p1");
	expect(routeFromHash("#new/~%2Fcode?project=p1")).toEqual({ kind: "page", page: { kind: "new", cwd: "~/code", projectId: "p1" } });
});

test("a new session's address with no project, or an empty one, names none", () => {
	expect(hashForNewSession({ cwd: "~/code" })).toBe("#new/~%2Fcode");
	expect(routeFromHash("#new?project=")).toEqual({ kind: "page", page: { kind: "new", cwd: null, projectId: null } });
});
