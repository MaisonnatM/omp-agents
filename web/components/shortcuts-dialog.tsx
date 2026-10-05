import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { bindingLabel, type Scope, scopeOf, SHORTCUTS } from "../shortcuts";

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

const keysIn = (scope: Scope): string =>
	LIST.format(SHORTCUTS.flatMap(({ keys }) => keys.filter(binding => scopeOf(binding) === scope).map(bindingLabel)));

/** Every dashboard shortcut, from the table the key listeners read. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border bg-popover p-5 text-popover-foreground shadow-md outline-hidden">
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
					<table className="mt-4 w-full text-sm" data-shortcuts>
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th className="pb-2 font-medium">Keys</th>
								<th className="pb-2 font-medium">Action</th>
							</tr>
						</thead>
						<tbody>
							{SHORTCUTS.map(({ id, keys, label }) => (
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
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
