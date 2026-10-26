/** Settings › Activity's report: every feature the page has, from its registries, split by how often the range used it. */
import { ACTION_MESSAGES, type ActivityKind, type ActivityRead, type ActivityUse, CONTROLS, featureId } from "../src/shared/activity";
import { commandKey, VIEWS } from "./activity";
import { SETTINGS_SECTIONS, type SidebarTab } from "./routing";
import { SHORTCUTS, type Shortcut, type ShortcutId } from "./shortcuts";

/** A feature as the page's registries name it; `tab` is the sidebar tab it goes with, which gates it on that tab's service. */
export interface Feature {
	kind: Exclude<ActivityKind, "presence">;
	key: string;
	label: string;
	tab?: SidebarTab;
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
	/** Gated on a tab whose service omp is not signed in to, so not counted against it. */
	notSetUp: Feature[];
}

/** Under this many uses in the range, a feature is rarely used. */
const RARELY = 3;
/** How many features **Most used** lists. */
const MOST_USED = 20;

/** The commands that go with a tab gated on a service, besides the Inbox page's own. */
const COMMAND_TABS: Partial<Record<ShortcutId, SidebarTab>> = { tickets: "tickets", newTicket: "tickets", inbox: "inbox" };

/** The `PUT` routes that go with a tab gated on a service, by path prefix. */
const ROUTE_TABS: Record<string, SidebarTab> = { "/api/ticket": "tickets", "/api/gmail/": "inbox" };

const commandTab = ({ id, category }: Shortcut): SidebarTab | undefined => (category === "inbox" ? "inbox" : COMMAND_TABS[id]);
const routeTab = (path: string): SidebarTab | undefined => Object.entries(ROUTE_TABS).find(([prefix]) => path.startsWith(prefix))?.[1];

/** Every feature the page has: views, commands, actions, and tagged controls, from the registries that define them. */
export function inventory(serverActions: readonly string[]): Feature[] {
	const gated = (tab: SidebarTab | undefined) => (tab ? { tab } : {});
	return [
		...VIEWS.map((view): Feature => ({ kind: "view", key: view.key, label: view.label, ...gated("tab" in view ? view.tab : undefined) })),
		...SETTINGS_SECTIONS.map(({ value, label }): Feature => ({ kind: "view", key: `settings/${value}`, label: `Settings › ${label}` })),
		...SHORTCUTS.map((shortcut): Feature => ({ kind: "command", key: commandKey(shortcut.id), label: shortcut.command ?? shortcut.label, ...gated(commandTab(shortcut)) })),
		...Object.entries(ACTION_MESSAGES).filter(([, action]) => action).map(([t]): Feature => ({ kind: "action", key: t, label: t })),
		...serverActions.map((path): Feature => ({ kind: "action", key: `put ${path}`, label: `PUT ${path}`, ...gated(routeTab(path)) })),
		...CONTROLS.map(({ id, label }): Feature => ({ kind: "control", key: id, label })),
	];
}

/** Splits `features` by their use in `answer`'s range; a feature whose tab is in `signedOut` is set apart. */
export function report(features: readonly Feature[], answer: Pick<ActivityRead, "uses" | "lastUsed">, signedOut: ReadonlySet<SidebarTab>): ActivityReport {
	const uses = new Map(answer.uses.map(use => [featureId(use.kind, use.key), use]));
	const last = new Map(answer.lastUsed.map(({ kind, key, at }) => [featureId(kind, key), at]));
	const result: ActivityReport = { used: [], rarely: [], mostUsed: [], never: [], notSetUp: [] };
	for (const feature of features) {
		if (feature.tab && signedOut.has(feature.tab)) {
			result.notSetUp.push(feature);
			continue;
		}
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
