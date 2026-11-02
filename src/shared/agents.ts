/** Discovered agent definitions and persisted defaults for a new-session preview, never a live session's catalog. */

/** The exact omp settings owned by Settings › Agents, shared by discovery, writes, and the settings index. */
export const AGENT_SETTINGS = {
	overrides: "task.agentModelOverrides",
	concurrency: "task.maxConcurrency",
	isolationEnabled: "task.isolation.enabled",
	isolationApply: "task.isolation.apply",
	isolationMerge: "task.isolation.merge",
} as const;

export type AgentModelOverride = string | string[];

export function isAgentModelOverride(value: unknown): value is AgentModelOverride {
	return typeof value === "string" || (Array.isArray(value) && value.every(item => typeof item === "string"));
}

export type AgentModelPreview =
	| { kind: "resolved"; selector: string; thinking?: string }
	| { kind: "inherited" }
	| { kind: "unresolved"; warning?: string }
	| { kind: "source-session" };

export interface AgentDefinitionPreview {
	name: string;
	description: string;
	scope: "user" | "project" | "bundled";
	origin: "native" | "plugin" | "bundled";
	package?: string;
	path?: string;
	tools: string[] | null;
	readOnly: boolean;
	disabled: boolean;
	/** Bundled seance takes its model from another session and cannot run in isolation. */
	seance: boolean;
	definition: string[];
	user?: AgentModelOverride;
	workspace?: AgentModelOverride;
	effective: string[];
	model: AgentModelPreview;
}

export interface AgentCatalog {
	context: "user-preview" | "workspace-preview";
	cwd: string | null;
	agents: AgentDefinitionPreview[];
	/** Includes entries whose definition is no longer discovered. */
	userOverrides: Record<string, AgentModelOverride>;
	roles: string[];
	/** Model lookup can fail without hiding the discovered definitions or their saved selectors. */
	modelError?: string;
}
