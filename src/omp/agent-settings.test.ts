import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME } from "../paths";
import type { AgentSettingRow, AgentSettings } from "../shared/agent-settings";
import { agentSetting, readAgentSettings, userValue } from "./agent-settings";
import { agentDir, loadGlobalForWrite, loadSessionSettings } from "./config";

const read = async (cwd: string | null): Promise<AgentSettings> => readAgentSettings(await loadSessionSettings(cwd ?? HOME), cwd !== null);
const rowsOf = (settings: AgentSettings): AgentSettingRow[] => settings.tabs.flatMap(tab => tab.groups.flatMap(group => group.rows));
const rowOf = (settings: AgentSettings, id: string): AgentSettingRow | undefined => rowsOf(settings).find(row => row.id === id);

describe("readAgentSettings", () => {
	test("omp's tabs come in its order, without the settings only its terminal draws", async () => {
		rmSync(join(agentDir, "config.yml"), { force: true });
		const settings = await read(null);
		expect(settings.tabs.map(tab => tab.id)).toEqual(["appearance", "model", "interaction", "context", "memory", "files", "shell", "tools", "tasks", "providers"]);
		expect(settings.tabs[0]?.groups.map(group => [group.label, group.rows.map(row => row.id)])).toEqual([
			["Display", ["showHardwareCursor", "task.showResolvedModelBadge", "title.icons"]],
			["Images", ["images.autoResize", "images.blockImages"]],
		]);
		expect(rowsOf(settings).filter(row => /^(tui|statusLine|display|theme|composer|terminal)\.|^(symbolPreset|colorBlindMode)$/.test(row.id))).toEqual([]);
		expect(settings.unlisted).toContain("modelRoles");
		expect(settings.unlisted).not.toContain("theme.dark");
	});

	test("each setting gets the control omp's panel gives it", async () => {
		const settings = await read(null);
		expect(rowOf(settings, "compaction.enabled")).toEqual({
			id: "compaction.enabled",
			label: "Auto-Compact",
			description: "Automatically compact context when it gets too large",
			control: { kind: "toggle" },
			default: true,
			credential: false,
		});
		const threshold = rowOf(settings, "compaction.thresholdPercent")?.control;
		expect(threshold?.kind === "select" && threshold.options[0]).toEqual({ value: -1, label: "Default", description: "Legacy reserve-based threshold" });
		expect(rowOf(settings, "compaction.methodOrder")?.control).toMatchObject({ kind: "list", ordered: true });
		expect(rowOf(settings, "tools.approval")?.control).toEqual({ kind: "json" });
		expect(rowOf(settings, "providers.maxInFlightRequests")?.control).toEqual({ kind: "provider-limits" });
		expect(rowOf(settings, "hindsight.apiToken")?.control).toEqual({ kind: "text", secret: true });
	});

	test("the dictation language, which omp's panel leaves out, is a row of the Speech group with a choice of languages", async () => {
		const settings = await read(null);
		const speech = settings.tabs.find(tab => tab.id === "interaction")?.groups.find(group => group.label === "Speech");
		expect(speech?.rows.map(row => row.id)).toContain("stt.language");
		const control = rowOf(settings, "stt.language")?.control;
		expect(control?.kind === "select" && control.options.find(option => option.value === "fr")).toEqual({ value: "fr", label: "French" });
		expect(settings.unlisted).not.toContain("stt.language");
	});

	test("a credential reaches the page only as whether it is set", async () => {
		writeFileSync(join(agentDir, "config.yml"), "hindsight:\n  apiToken: very-secret-token\n");
		const settings = await read(null);
		expect(rowOf(settings, "hindsight.apiToken")).toMatchObject({ user: true, credential: true });
		expect(rowOf(settings, "hindsight.apiToken")?.default).toBeUndefined();
		expect(JSON.stringify(settings)).not.toContain("very-secret-token");
		rmSync(join(agentDir, "config.yml"));
	});

	test("a workspace's own value shows beside the user's", async () => {
		writeFileSync(join(agentDir, "config.yml"), "compaction:\n  enabled: true\n");
		const project = mkdtempSync(join(tmpdir(), "omp-agents-project-"));
		mkdirSync(join(project, ".omp"));
		writeFileSync(join(project, ".omp", "config.yml"), "compaction:\n  enabled: false\n");
		try {
			expect(rowOf(await read(project), "compaction.enabled")).toMatchObject({ user: true, workspace: false });
			expect(rowOf(await read(null), "compaction.enabled")).not.toHaveProperty("workspace");
		} finally {
			rmSync(project, { recursive: true, force: true });
			rmSync(join(agentDir, "config.yml"));
		}
	});
});

describe("userValue", () => {
	test("is the user's value as the page shows it: null when unset, true for a credential", async () => {
		writeFileSync(join(agentDir, "config.yml"), "compaction:\n  enabled: false\nhindsight:\n  apiToken: very-secret-token\n");
		try {
			const settings = await loadGlobalForWrite(HOME);
			const handle = (id: string) => agentSetting(id) ?? expect.unreachable(`omp has no setting ${id}`);
			expect(userValue(handle("compaction.enabled"), settings)).toBe(false);
			expect(userValue(handle("hindsight.apiToken"), settings)).toBe(true);
			expect(userValue(handle("compaction.thresholdPercent"), settings)).toBeNull();
		} finally {
			rmSync(join(agentDir, "config.yml"));
		}
	});
});

describe("agentSetting", () => {
	test("finds a setting a session reads, but not one only omp's terminal draws or one omp lacks", () => {
		expect(agentSetting("compaction.enabled")?.id).toBe("compaction.enabled");
		expect(agentSetting("theme.dark")).toBeUndefined();
		expect(agentSetting("symbolPreset")).toBeUndefined();
		expect(agentSetting("no.such.setting")).toBeUndefined();
	});
});
