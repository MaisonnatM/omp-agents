/** Settings › Activity's report: every feature the page has, from its registries, split by how often the range used it. */
import type { McpIntegrationId } from "../src/shared/accounts";
import { ACTION_MESSAGES, type ActivityKind, type ActivityRead, type ActivityUse, CONTROLS } from "../src/shared/activity";
import { commandKey } from "./activity";
import { PAGE_KINDS, SETTINGS_SECTIONS, SIDEBAR_TABS } from "./routing";
import { SHORTCUTS } from "./shortcuts";

/** A feature as the page's registries name it; `integration` gates it on a service omp is signed in to. */
export interface Feature {
	kind: Exclude<ActivityKind, "presence">;
	key: string;
	label: string;
	integration?: McpIntegrationId;
}

/** A feature the range used, with its use. */
export type UsedFeature = Feature & { use: ActivityUse };

export interface ActivityReport {
	/** Used three times or more in the range. */
	used: UsedFeature[];
	/** Used once or twice in the range. */
	rarely: UsedFeature[];
	/** Not used in the range, with its last use ever, `null` for never. */
	never: (Feature & { lastAt: number | null })[];
	/** Gated on a service omp is not signed in to, so not counted against it. */
	notSetUp: Feature[];
}

/** Under this many uses in the range, a feature is rarely used. */
const RARELY = 3;

/** The views that are no page: the panes by how many there are and of what kind. */
const PANE_VIEWS: Feature[] = [
	{ kind: "view", key: "home", label: "Home" },
	{ kind: "view", key: "session", label: "A session" },
	{ kind: "view", key: "past", label: "A past session" },
	{ kind: "view", key: "split", label: "Split panes" },
];

/** Every feature the page has: views, commands, actions, and tagged controls, from the registries that define them. */
export function inventory(serverActions: readonly string[]): Feature[] {
	const tabs = new Map<string, { label: string; integration?: McpIntegrationId }>(SIDEBAR_TABS.map(tab => [tab.value, tab]));
	const pages = PAGE_KINDS.filter(kind => kind !== "settings").map((kind): Feature => {
		const tab = tabs.get(kind);
		return { kind: "view", key: kind, label: tab?.label ?? kind[0]!.toUpperCase() + kind.slice(1), ...(tab?.integration && { integration: tab.integration }) };
	});
	return [
		...PANE_VIEWS,
		...pages,
		...SETTINGS_SECTIONS.map(({ value, label }): Feature => ({ kind: "view", key: `settings/${value}`, label: `Settings › ${label}` })),
		...SHORTCUTS.map(({ id, command, label }): Feature => ({ kind: "command", key: commandKey(id), label: command ?? label })),
		...Object.entries(ACTION_MESSAGES).filter(([, action]) => action).map(([t]): Feature => ({ kind: "action", key: t, label: t })),
		...serverActions.map((path): Feature => ({ kind: "action", key: `put ${path}`, label: `PUT ${path}` })),
		...CONTROLS.map(({ id, label }): Feature => ({ kind: "control", key: id, label })),
	];
}

/** Splits `features` by their use in `answer`'s range; a feature gated on a service not in `setUp` is set apart. */
export function report(features: readonly Feature[], answer: Pick<ActivityRead, "uses" | "lastUsed">, setUp: ReadonlySet<McpIntegrationId>): ActivityReport {
	const id = (kind: string, key: string): string => `${kind}\u0000${key}`;
	const uses = new Map(answer.uses.map(use => [id(use.kind, use.key), use]));
	const last = new Map(answer.lastUsed.map(({ kind, key, at }) => [id(kind, key), at]));
	const result: ActivityReport = { used: [], rarely: [], never: [], notSetUp: [] };
	for (const feature of features) {
		if (feature.integration && !setUp.has(feature.integration)) {
			result.notSetUp.push(feature);
			continue;
		}
		const use = uses.get(id(feature.kind, feature.key));
		if (!use) result.never.push({ ...feature, lastAt: last.get(id(feature.kind, feature.key)) ?? null });
		else (use.count < RARELY ? result.rarely : result.used).push({ ...feature, use });
	}
	result.used.sort((a, b) => b.use.count - a.use.count);
	result.rarely.sort((a, b) => b.use.count - a.use.count);
	return result;
}
