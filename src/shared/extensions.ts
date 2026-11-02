export type ExtensionScope = "user" | "project";
export type ExtensionKind = "marketplace" | "plugin" | "registry-skill";
export type ExtensionTarget =
	| { kind: "marketplace"; id: string; scope: ExtensionScope }
	| { kind: "plugin"; id: string; scope: "user" }
	| { kind: "registry-skill"; id: string; scope: ExtensionScope };
export type SwitchableExtensionTarget = Exclude<ExtensionTarget, { kind: "registry-skill" }>;

export const EXTENSION_CONTRIBUTION_KINDS = ["skills", "slash-commands", "hooks", "tools", "mcps", "extension-modules", "rules", "prompts", "agents"] as const;
export type ExtensionContributionKind = (typeof EXTENSION_CONTRIBUTION_KINDS)[number];
export interface ExtensionContributionTarget {
	kind: ExtensionContributionKind;
	path: string;
	provider: string;
	scope: ExtensionScope | "native";
}
export interface ExtensionContribution extends ExtensionContributionTarget {
	name: string;
	state: "available" | "disabled" | "shadowed" | "declared" | "missing";
	invocation: string | null;
}
export interface ExtensionPackage {
	target: ExtensionTarget;
	name: string;
	source: string | null;
	version: string | null;
	range: string | null;
	root: string | null;
	description: string;
	enabled: boolean | null;
	shadowedBy: "project" | null;
	stored: boolean;
	contributions: ExtensionContribution[];
	inventory: "unavailable" | "undiscovered" | null;
	availableVersion: string | null;
	updateNote: string | null;
}
export interface ExtensionSource {
	name: string;
	sourceUri: string;
	updatedAt: string;
}
export interface ExtensionProvider {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	foreign: boolean;
	userEnabled: boolean;
}
export interface ExtensionsAnswer {
	cwd: string | null;
	packages: ExtensionPackage[];
	items: ExtensionContribution[];
	providers: ExtensionProvider[];
	sources: ExtensionSource[];
	registry: { url: string; global: string; overridden: boolean };
	projectTarget: string | null;
	userTargets: { plugins: string; skills: string };
	diagnostics: string[];
}
export interface ExtensionCatalogEntry {
	key: string;
	kind: "marketplace" | "registry-skill";
	id: string;
	name: string;
	source: string;
	version: string | null;
	description: string;
}
export interface ExtensionCatalog {
	entries: ExtensionCatalogEntry[];
	page: number;
	more: boolean;
	diagnostics: string[];
}
export type ExtensionInstall = { kind: "install"; spec: string; source: string } & (
	{ packageKind: "plugin"; scope: "user" } | { packageKind: "marketplace" | "registry-skill"; scope: ExtensionScope }
);
export type ExtensionChange =
	| ExtensionInstall
	| { kind: "update"; target: ExtensionTarget }
	| { kind: "uninstall"; target: ExtensionTarget }
	| { kind: "enabled"; target: SwitchableExtensionTarget; enabled: boolean }
	| { kind: "skill-enabled"; name: string; enabled: boolean }
	| { kind: "source-add"; source: string }
	| { kind: "source-refresh"; name: string }
	| { kind: "source-remove"; name: string }
	| { kind: "registry"; url: string }
	| { kind: "provider"; id: string; enabled: boolean; userOnly: boolean };
export interface ExtensionScriptApproval {
	token: string;
	id: string;
	version: string;
	files: { path: string; executable: boolean }[];
}
export type ExtensionOperation = { id: string; warnings: string[] } & (
	| { state: "working" }
	| { state: "needs-approval"; approval: ExtensionScriptApproval }
	| { state: "done"; message: string }
	| { state: "failed"; error: string }
);
