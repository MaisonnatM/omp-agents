import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chordLabel, type Shortcut, SHORTCUTS } from "../shortcuts";

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

const chordsIn = (where: Shortcut["scope"]): string =>
	LIST.format(SHORTCUTS.filter(({ scope }) => scope === where).map(({ chord }) => chordLabel(chord)));

/** The dashboard's `/hotkeys`: every shortcut next to the omp chord it mirrors. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-popover p-5 text-popover-foreground shadow-md outline-hidden">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-base font-semibold">Keyboard shortcuts</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								{chordsIn("composer")} work in the composer. {chordsIn("outside-fields")} works outside text fields. The rest work
								anywhere, even while you type. Session chords act on the focused pane.
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button variant="ghost" size="icon-compact" aria-label="Close" title="Close">
								<X />
							</Button>
						</DialogPrimitive.Close>
					</div>
					<table className="mt-4 w-full text-sm" data-shortcuts>
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th className="pb-2 font-medium">Keys</th>
								<th className="pb-2 font-medium">Action</th>
								<th className="pb-2 font-medium">In omp</th>
							</tr>
						</thead>
						<tbody>
							{SHORTCUTS.map(({ id, chord, label, omp }) => (
								<tr key={id} className="border-t border-border" data-shortcut={id}>
									<td className="py-2 pr-4 align-top whitespace-nowrap">
										<kbd className="inline-flex h-[22px] items-center rounded-[5px] border border-border bg-background px-1.5 font-sans text-xs">
											{chordLabel(chord)}
										</kbd>
									</td>
									<td className="py-2 pr-4 align-top">{label}</td>
									<td className="py-2 align-top text-muted-foreground">
										{omp ? (
											<>
												<span className="whitespace-nowrap">{omp.chord}</span>
												{omp.action !== omp.chord && <span className="block font-mono text-xs">{omp.action}</span>}
											</>
										) : (
											"Dashboard only"
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
