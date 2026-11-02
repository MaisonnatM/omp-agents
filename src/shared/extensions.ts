export type ExtensionScope = "user" | "project";
export type ExtensionKind = "marketplace" | "plugin" | "registry-skill";
export interface ExtensionContribution {
	key: string;
	kind: string;
	name: string;
	path: string;
	provider: string;
	scope: ExtensionScope | "native";
	state: "available" | "disabled" | "shadowed" | "declared" | "missing";
	invocation: string | null;
}
export interface ExtensionPackage {
	key: string;
	kind: ExtensionKind;
	id: string;
	name: string;
	source: string;
	scope: ExtensionScope;
	version: string | null;
	range: string | null;
	root: string | null;
	description: string;
	enabled: boolean | null;
	shadowedBy: "project" | null;
	stored: boolean;
	contributions: ExtensionContribution[];
	inventoryNote: string | null;
	availableVersion: string | null;
	updateNote: string | null;
}
export interface ExtensionSource { name: string; sourceUri: string; updatedAt: string }
export interface ExtensionProvider { id: string; name: string; description: string; enabled: boolean; foreign: boolean; userEnabled: boolean }
export interface ExtensionsAnswer {
	cwd: string | null;
	packages: ExtensionPackage[];
	items: ExtensionContribution[];
	providers: ExtensionProvider[];
	sources: ExtensionSource[];
	registry: { url: string; global: string; overridden: boolean };
	projectTarget: string | null;
	userTargets: Record<ExtensionKind, string>;
	diagnostics: string[];
}
export interface ExtensionCatalogEntry { key: string; kind: "marketplace" | "registry-skill"; id: string; name: string; source: string; version: string | null; description: string }
export interface ExtensionCatalog { entries: ExtensionCatalogEntry[]; page: number; more: boolean; diagnostics: string[] }
export type ExtensionChange =
	| { kind: "install"; packageKind: ExtensionKind; spec: string; source: string; scope: ExtensionScope }
	| { kind: "update" | "uninstall"; key: string }
	| { kind: "enabled"; key: string; enabled: boolean }
	| { kind: "skill-enabled"; name: string; enabled: boolean }
	| { kind: "source-add"; source: string }
	| { kind: "source-refresh"; name: string }
	| { kind: "source-remove"; name: string }
	| { kind: "registry"; url: string }
	| { kind: "provider"; id: string; enabled: boolean; userOnly: boolean };
export interface ExtensionScriptApproval { token: string; id: string; version: string; files: { path: string; executable: boolean }[] }
export type ExtensionOperation = { id: string; warnings: string[] } & (
	| { state: "working" }
	| { state: "needs-approval"; approval: ExtensionScriptApproval }
	| { state: "done"; message: string }
	| { state: "failed"; error: string }
);
