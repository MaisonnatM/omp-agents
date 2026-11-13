/** The Settings Keyboard section: every dashboard shortcut, from the table the key listeners read, by category. */
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { bindingLabel, IS_MAC, type Shortcut, SHORTCUT_CATEGORIES, SHORTCUTS, scopeOf } from "../../shortcuts";
import { Kbd } from "../kbd";
import { Section } from "./editor";

const MODIFIERS = IS_MAC ? "⌘, ⌥, or ⌃" : "Ctrl or Alt";

function ShortcutTable({ caption, rows }: { caption: string; rows: readonly Shortcut[] }) {
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

/** The shortcuts that have a key, in {@link SHORTCUTS} order. */
const ROWS = SHORTCUTS.filter(({ keys }) => keys.length > 0);

/** Every shortcut that has a key, one section per category. */
export function KeyboardTab() {
	return (
		<>
			<p className="max-w-prose text-sm text-muted-foreground">
				Shortcuts with {MODIFIERS} work anywhere, even while you type. Single keys and G pairs work outside text fields. Session shortcuts act on the focused pane.
			</p>
			{SHORTCUT_CATEGORIES.map(({ id, label }) => (
				<Section key={id} title={label}>
					<ShortcutTable caption={label} rows={ROWS.filter(row => row.category === id)} />
				</Section>
			))}
		</>
	);
}
