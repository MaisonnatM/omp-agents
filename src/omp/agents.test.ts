import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSettings } from "../shared/agent-settings";
import type { AgentCatalog } from "../shared/agents";

/** Native agent discovery uses HOME independently of PI_CODING_AGENT_DIR, so each case runs in an isolated process. */
async function preview(home: string, cwd: string | null): Promise<{ catalog: AgentCatalog; settings: AgentSettings }> {
	const child = Bun.spawn([process.execPath, "--eval", `
		import { loadOmpSettings } from ${JSON.stringify(import.meta.dir + "/../settings.ts")};
		const loaded = await loadOmpSettings(${JSON.stringify(cwd)});
		if ("error" in loaded.agents) throw new Error(loaded.agents.error);
		if ("error" in loaded.agentSettings) throw new Error(loaded.agentSettings.error);
		console.log(JSON.stringify({ catalog: loaded.agents, settings: loaded.agentSettings }));
	`], { env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: join(home, ".omp", "agent") }, stdout: "pipe", stderr: "pipe" });
	const [text, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (exit !== 0) throw new Error(stderr);
	return JSON.parse(text);
}

describe("new-session agent preview", () => {
	test("omp chooses the winning project definition, keeps disabled agents, and reads entry-level model layers", async () => {
		const home = await mkdtemp(join(tmpdir(), "agents-preview-"));
		const agentDir = join(home, ".omp", "agent");
		const cwd = join(home, "project");
		await mkdir(join(cwd, ".omp", "agents"), { recursive: true });
		await mkdir(join(agentDir, "agents"), { recursive: true });
		try {
			await writeFile(join(agentDir, "agents", "preview-reviewer.md"), "---\nname: preview-reviewer\ndescription: User reviewer\nmodel: ['unavailable/user']\n---\nReview.\n");
			await writeFile(join(cwd, ".omp", "agents", "preview-reviewer.md"), "---\nname: preview-reviewer\ndescription: Project reviewer\ntools: [read, grep]\nmodel: ['unavailable/definition']\n---\nReview.\n");
			await writeFile(join(agentDir, "config.yml"), "task:\n  agentModelOverrides:\n    preview-reviewer: ['unavailable/user:high', '@slow']\n    missing-reviewer: unavailable/missing\n");
			await writeFile(join(cwd, ".omp", "config.yml"), "task:\n  disabledAgents: [preview-reviewer]\n  agentModelOverrides:\n    preview-reviewer: unavailable/workspace\n  maxConcurrency: 4\n  isolation:\n    enabled: true\n");
			const { catalog, settings } = await preview(home, cwd);
			expect(catalog.context).toBe("workspace-preview");
			expect(catalog.agents.find(agent => agent.name === "preview-reviewer")).toMatchObject({
				description: "Project reviewer", scope: "project", origin: "native", tools: ["read", "grep"], readOnly: true, disabled: true, seance: false,
				definition: ["unavailable/definition"], user: ["unavailable/user:high", "@slow"], workspace: "unavailable/workspace", effective: ["unavailable/workspace"], model: { kind: "unresolved" },
			});
			expect(catalog.userOverrides["missing-reviewer"]).toBe("unavailable/missing");
			const rows = settings.tabs.flatMap(tab => tab.groups.flatMap(group => group.rows));
			expect(rows.find(row => row.id === "task.maxConcurrency")).toMatchObject({ workspace: 4, default: 32 });
			expect(rows.find(row => row.id === "task.isolation.enabled")).toMatchObject({ workspace: true, default: false });
			expect(catalog).not.toHaveProperty("execution");
			await mkdir(join(home, ".omp", "agents"), { recursive: true });
			await writeFile(join(home, ".omp", "agents", "preview-reviewer.md"), "---\nname: preview-reviewer\ndescription: Home project reviewer\n---\nReview.\n");
			await writeFile(join(home, ".omp", "config.yml"), "task:\n  maxConcurrency: 2\n  agentModelOverrides:\n    preview-reviewer: unavailable/home-project\n");
			const { catalog: user, settings: userSettings } = await preview(home, null);
			expect(user.context).toBe("user-preview");
			expect(user.agents.some(agent => agent.scope === "project")).toBe(false);
			expect(user.agents.find(agent => agent.name === "preview-reviewer")).toMatchObject({ description: "User reviewer", scope: "user" });
			expect(userSettings.tabs.flatMap(tab => tab.groups.flatMap(group => group.rows)).find(row => row.id === "task.maxConcurrency")).not.toHaveProperty("workspace");
			expect(user.agents.find(agent => agent.name === "preview-reviewer")?.effective).not.toContain("unavailable/home-project");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("bundled seance cannot preview a stale override as effective, while normal agents inherit the session", async () => {
		const home = await mkdtemp(join(tmpdir(), "agents-seance-"));
		await mkdir(join(home, ".omp", "agent"), { recursive: true });
		try {
			await writeFile(join(home, ".omp", "agent", "config.yml"), "task:\n  agentModelOverrides:\n    seance: unavailable/ignored\n");
			const { catalog } = await preview(home, null);
			expect(catalog.agents.find(agent => agent.name === "seance")).toMatchObject({ scope: "bundled", seance: true, user: "unavailable/ignored", effective: [], model: { kind: "source-session" } });
			expect(catalog.agents.find(agent => agent.name === "task")?.model).toEqual({ kind: "inherited" });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
