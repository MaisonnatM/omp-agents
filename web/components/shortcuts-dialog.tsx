import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type CSSProperties, Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import type { SidebarTab } from "../routing";
import { bindingLabel, IS_MAC, SHORTCUT_CATEGORIES, scopeOf } from "../shortcuts";
import { type ShortcutRow, shortcutRows } from "../sidebar-tabs";

/** The pinned header row's height, where the panel's top fade begins. */
const HEADER_HEIGHT = "2rem";

const MODIFIERS = IS_MAC ? "⌘, ⌥, or ⌃" : "Ctrl or Alt";

/** At fractional zoom such as 125%, Chromium paints the pinned header a few pixels below the scroller's top, so a shadow in the popover's color covers the rows there. */
const HEADING = "border-b border-border bg-popover align-middle font-medium shadow-[0_-0.5rem_0_var(--popover)]";

function ShortcutTable({ rows }: { rows: readonly ShortcutRow[] }) {
	return (
		<table className="w-full border-separate border-spacing-0 text-sm" data-shortcuts>
			<thead className="sticky top-0 text-left text-xs text-muted-foreground">
				<tr style={{ height: HEADER_HEIGHT }}>
					<th className={HEADING}>Keys</th>
					<th className={HEADING}>Action</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(({ id, keys, label }) => (
					<tr key={id} className="[&:not(:first-child)>td]:border-t [&>td]:border-border" data-shortcut={id}>
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

/** Every dashboard shortcut, from the table the key listeners read, as {@link shortcutRows} lists it while the sidebar shows `tabs`, one tab per category. */
export function ShortcutsDialog({ open, onOpenChange, tabs }: { open: boolean; onOpenChange: (open: boolean) => void; tabs: readonly SidebarTab[] }) {
	const rows = useMemo(() => shortcutRows(tabs), [tabs]);

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
								Shortcuts with {MODIFIERS} work anywhere, even while you type. Single keys and G pairs work outside text fields.
								Session shortcuts act on the focused pane.
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
							<TabPanel key={id} value={id} className="mt-3 flex min-h-0 flex-1 flex-col">
								{/* Radix sets animation-duration: 0s on the first panel, which would pin the scroll-driven fade at its end, so the fade goes on a child. */}
								<div
									className="scroll-fade scroll-fade-once-scrolled scroll-fade-under-header min-h-0 flex-1 overflow-y-auto"
									style={{ "--scroll-fade-header": HEADER_HEIGHT } as CSSProperties}
								>
									<ShortcutTable rows={rows.filter(row => row.category === id)} />
								</div>
							</TabPanel>
						))}
					</Tabs>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
