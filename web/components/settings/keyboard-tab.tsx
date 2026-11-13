/** The Settings Keyboard section: every dashboard shortcut, from the table the key listeners read, by category. */
import { Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { bindingLabel, IS_MAC, SHORTCUT_CATEGORIES, scopeOf } from "../../shortcuts";
import { type ShortcutRow, shortcutRows, useSidebarTabs } from "../../sidebar-tabs";
import { Kbd } from "../kbd";
import { Section } from "./editor";

const MODIFIERS = IS_MAC ? "⌘, ⌥, or ⌃" : "Ctrl or Alt";

function ShortcutTable({ caption, rows }: { caption: string; rows: readonly ShortcutRow[] }) {
	return (
		<table className="w-full border-separate border-spacing-0 text-sm" data-shortcuts>
			<caption className="sr-only">{caption} shortcuts</caption>
			<thead className="sr-only">
				<tr>
					<th>Keys</th>
					<th>Action</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(({ id, keys, label }) => (
					<tr key={id} className="[&:not(:first-child)>td]:border-t [&>td]:border-border" data-shortcut={id}>
						<td className="w-0 py-2 pr-6 align-top whitespace-nowrap">
							{keys.map((binding, index) => (
								<Fragment key={bindingLabel(binding)}>
									{index > 0 && <span className="px-1 text-xs text-muted-foreground">or</span>}
									<Kbd className="text-foreground">{bindingLabel(binding)}</Kbd>
								</Fragment>
							))}
						</td>
						<td className="py-2 align-top">
							<div className="flex items-start justify-between gap-3">
								{label}
								{keys.some(binding => scopeOf(binding) === "composer") && (
									<Badge size="compact" className="shrink-0">
										Composer only
									</Badge>
								)}
							</div>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** Every shortcut as {@link shortcutRows} lists it while the sidebar shows its tabs, one section per category. */
export function KeyboardTab() {
	const { shown } = useSidebarTabs();
	const rows = useMemo(() => shortcutRows(shown), [shown]);
	return (
		<>
			<p className="max-w-prose text-sm text-muted-foreground">
				Shortcuts with {MODIFIERS} work anywhere, even while you type. Single keys and G pairs work outside text fields. Session shortcuts act on the focused pane.
			</p>
			{SHORTCUT_CATEGORIES.map(({ id, label }) => (
				<Section key={id} title={label}>
					<ShortcutTable caption={label} rows={rows.filter(row => row.category === id)} />
				</Section>
			))}
		</>
	);
}
