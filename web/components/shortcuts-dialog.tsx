import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Fragment, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { type Binding, bindingLabel, type Scope, SHORTCUT_CATEGORIES, type ShortcutCategory, type ShortcutId, scopeOf, SHORTCUTS, TAB_SHORTCUTS, tabBindings } from "../shortcuts";

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

const POSITIONS: ReadonlySet<ShortcutId> = new Set(TAB_SHORTCUTS);

interface ShortcutRow {
	id: ShortcutId;
	category: ShortcutCategory;
	label: string;
	keys: readonly Binding[];
}

function ShortcutTable({ rows }: { rows: readonly ShortcutRow[] }) {
	return (
		<table className="w-full text-sm" data-shortcuts>
			<thead className="text-left text-xs text-muted-foreground">
				<tr>
					<th className="pb-2 font-medium">Keys</th>
					<th className="pb-2 font-medium">Action</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(({ id, keys, label }) => (
					<tr key={id} className="border-t border-border" data-shortcut={id}>
						<td className="py-2 pr-4 align-top whitespace-nowrap">
							{keys.map((binding, index) => (
								<Fragment key={bindingLabel(binding)}>
									{index > 0 && <span className="px-1 text-xs text-muted-foreground">or</span>}
									<kbd className="inline-flex h-[22px] items-center rounded-[5px] border border-border bg-background px-1.5 font-sans text-xs">
										{bindingLabel(binding)}
									</kbd>
								</Fragment>
							))}
						</td>
						<td className="py-2 align-top">{label}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * Every dashboard shortcut, from the table the key listeners read, one tab per category. A tab's row shows the position
 * key it takes among `tabs`, the tabs the sidebar shows, so the position keys have no rows of their own, and a row with
 * no key left is out.
 */
export function ShortcutsDialog({ open, onOpenChange, tabs }: { open: boolean; onOpenChange: (open: boolean) => void; tabs: readonly ShortcutId[] }) {
	const rows = useMemo(
		() =>
			SHORTCUTS.flatMap(({ id, category, label }): ShortcutRow[] => {
				const keys = POSITIONS.has(id) ? [] : tabBindings(id, tabs);
				return keys.length > 0 ? [{ id, category, label, keys }] : [];
			}),
		[tabs],
	);
	const keysIn = (scope: Scope): string => LIST.format(rows.flatMap(({ keys }) => keys.filter(binding => scopeOf(binding) === scope).map(bindingLabel)));

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				{/* A fixed height keeps the dialog still while the tabs change. */}
				<DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(34rem,calc(100vh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border bg-popover p-5 text-popover-foreground shadow-md outline-hidden">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-base font-semibold">Keyboard shortcuts</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								{keysIn("composer")} work in the composer. {keysIn("outside-fields")} work outside text fields. The rest work
								anywhere, even while you type. Session shortcuts act on the focused pane.
							</DialogPrimitive.Description>
						</div>
						<Tooltip content="Close" shortcut={["Esc"]} side="bottom">
							<DialogPrimitive.Close asChild>
								<Button variant="ghost" size="icon-compact" aria-label="Close">
									<X />
								</Button>
							</DialogPrimitive.Close>
						</Tooltip>
					</div>
					<Tabs size="compact" defaultValue={SHORTCUT_CATEGORIES[0].id} className="mt-4 flex min-h-0 flex-1 flex-col">
						<TabsList aria-label="Category" className="self-start">
							{SHORTCUT_CATEGORIES.map(({ id, label }) => (
								<TabItem key={id} value={id} label={label} />
							))}
						</TabsList>
						{SHORTCUT_CATEGORIES.map(({ id }) => (
							<TabPanel key={id} value={id} className="mt-3 min-h-0 flex-1 overflow-y-auto">
								<ShortcutTable rows={rows.filter(row => row.category === id)} />
							</TabPanel>
						))}
					</Tabs>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
