/** Settings › Activity's report: every feature the page has, from its registries, split by how often the range used it. */
import { ACTION_MESSAGES, type ActivityKind, type ActivityRead, type ActivityUse, CONTROLS, featureId } from "../src/shared/activity";
import { commandKey, VIEWS } from "./activity";
import { MODULE_LIST } from "./modules";
import { SETTINGS_SECTIONS } from "./routing";
import { SHORTCUTS } from "./shortcuts";

/** A feature as the page's registries name it. */
export interface Feature {
	kind: Exclude<ActivityKind, "presence">;
	key: string;
	label: string;
}

/** A feature the range used, with its use. */
export type UsedFeature = Feature & { use: ActivityUse };

export interface ActivityReport {
	/** Used three times or more in the range. */
	used: UsedFeature[];
	/** Used once or twice in the range. */
	rarely: UsedFeature[];
	/** The most used features, at most {@link MOST_USED}, most first. */
	mostUsed: UsedFeature[];
	/** Not used in the range, with its last use ever, `null` for never. */
	never: (Feature & { lastAt: number | null })[];
}

/** Under this many uses in the range, a feature is rarely used. */
const RARELY = 3;
/** How many features **Most used** lists. */
const MOST_USED = 20;

/** Every feature the page has: views, commands, actions, and tagged controls, from the registries that define them. */
export function inventory(serverActions: readonly string[]): Feature[] {
	return [
		...VIEWS.map((view): Feature => ({ kind: "view", key: view.key, label: view.label })),
		...SETTINGS_SECTIONS.map(({ value, label }): Feature => ({ kind: "view", key: `settings/${value}`, label: `Settings › ${label}` })),
		...SHORTCUTS.map((shortcut): Feature => ({ kind: "command", key: commandKey(shortcut.id), label: shortcut.command ?? shortcut.label })),
		...Object.entries(ACTION_MESSAGES).filter(([, action]) => action).map(([t]): Feature => ({ kind: "action", key: t, label: t })),
		...serverActions.map((path): Feature => ({ kind: "action", key: `put ${path}`, label: `PUT ${path}` })),
		...[...CONTROLS, ...MODULE_LIST.flatMap(module => module.controls)].map(({ id, label }): Feature => ({ kind: "control", key: id, label })),
	];
}

/** Splits `features` by their use in `answer`'s range. */
export function report(features: readonly Feature[], answer: Pick<ActivityRead, "uses" | "lastUsed">): ActivityReport {
	const uses = new Map(answer.uses.map(use => [featureId(use.kind, use.key), use]));
	const last = new Map(answer.lastUsed.map(({ kind, key, at }) => [featureId(kind, key), at]));
	const result: ActivityReport = { used: [], rarely: [], mostUsed: [], never: [] };
	for (const feature of features) {
		const id = featureId(feature.kind, feature.key);
		const use = uses.get(id);
		if (!use) result.never.push({ ...feature, lastAt: last.get(id) ?? null });
		else (use.count < RARELY ? result.rarely : result.used).push({ ...feature, use });
	}
	result.used.sort((a, b) => b.use.count - a.use.count);
	result.rarely.sort((a, b) => b.use.count - a.use.count);
	result.mostUsed = [...result.used, ...result.rarely].slice(0, MOST_USED);
	return result;
}
