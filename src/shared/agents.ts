/** Discovered agent definitions and persisted defaults for a new-session preview, never a live session's catalog. */
import type { AgentSettingRow } from "./agent-settings";

export type AgentModelOverride = string | string[];
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
	execution: AgentSettingRow[];
	/** Model lookup can fail without hiding the discovered definitions or their saved selectors. */
	modelError?: string;
}
