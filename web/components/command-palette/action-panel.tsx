import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@ui-sdk/react/command";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect } from "react";
import { cn } from "@/lib/utils";
import { actionChord, chordAction, PANEL_CHORD, type PaletteAction, type PaletteItem } from "../../command-palette";
import { chordLabel, pressesChord } from "../../shortcuts";
import { Kbd } from "../kbd";
import { FooterButton } from "./palette-footer";

interface ActionPanelProps {
	/** The highlighted item, whose actions the panel lists; `null` disables the Actions button. */
	item: PaletteItem | null;
	/** What is typed in the panel's search, or `null` while the panel is closed. */
	query: string | null;
	onToggle: () => void;
	onQuery: (query: string) => void;
	onRun: (action: PaletteAction) => void;
	/** Focus the palette's search field, as the panel closes. */
	returnFocus: () => void;
}

/**
 * The Actions button, and the panel above it with every action of the highlighted item, searchable, each with its
 * chord. The panel stays inside the palette's dialog rather than a portal, so the dialog's focus trap and scroll lock
 * leave it alone, and Esc reaches the palette, which closes the panel first.
 */
export function ActionPanel({ item, query, onToggle, onQuery, onRun, returnFocus }: ActionPanelProps) {
	return (
		<>
			<FooterButton disabled={!item} aria-expanded={query !== null} aria-haspopup="dialog" onClick={onToggle}>
				Actions
				<Kbd size="sm">{chordLabel(PANEL_CHORD)}</Kbd>
			</FooterButton>
			{item && query !== null && <Panel item={item} query={query} onToggle={onToggle} onQuery={onQuery} onRun={onRun} returnFocus={returnFocus} />}
		</>
	);
}

function Panel({ item, query, onToggle, onQuery, onRun, returnFocus }: ActionPanelProps & { item: PaletteItem; query: string }) {
	useEffect(() => returnFocus, [returnFocus]);
	const onKeyDown = (event: ReactKeyboardEvent): void => {
		if (event.nativeEvent.isComposing) return;
		// Esc closes the panel whatever is typed, rather than first clearing its search.
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onToggle();
			return;
		}
		// The palette reads keys that reach it for its own list.
		if (pressesChord(event, PANEL_CHORD)) {
			event.preventDefault();
			event.stopPropagation();
			onToggle();
			return;
		}
		const action = chordAction(item, event);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		onRun(action);
	};
	return (
		<>
			{/* Within the dialog's transform, `fixed` covers the palette alone; a click elsewhere in it closes the panel. */}
			<div aria-hidden className="fixed inset-0 z-10" onPointerDown={onToggle} />
			<div role="dialog" aria-label={`Actions for ${item.title}`} className="absolute right-2 bottom-full z-20 mb-1 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
				<Command loop query={query} onQueryChange={onQuery}>
					<CommandEmpty className="py-6 text-center text-sm text-muted-foreground empty:hidden">No action matches.</CommandEmpty>
					<CommandList className="max-h-[min(18rem,45vh)] scroll-py-1 overflow-y-auto p-1">
						{item.actions.map((group, index) => (
							<CommandGroup key={group[0].id}>
								{index > 0 && <CommandSeparator className="-mx-1 my-1 h-px bg-border" />}
								{group.map(action => {
									const { icon: Icon } = action;
									const chord = actionChord(item, action);
									return (
										<CommandItem
											key={action.id}
											value={action.id}
											label={action.title}
											disabled={action.disabled}
											aria-busy={(action.id === "end" && action.disabled) || undefined}
											onSelect={() => onRun(action)}
											className={cn(
												"flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
												action.tone === "destructive" ? "text-destructive data-highlighted:bg-destructive/10" : "[&_svg]:text-muted-foreground",
											)}
										>
											<Icon />
											<span className="min-w-0 flex-1 truncate">{action.title}</span>
											{chord && <Kbd size="sm">{chordLabel(chord)}</Kbd>}
										</CommandItem>
									);
								})}
							</CommandGroup>
						))}
					</CommandList>
					<CommandInput
						autoFocus
						aria-label={`Search actions for ${item.title}`}
						onKeyDown={onKeyDown}
						placeholder="Search actions…"
						className="h-10 w-full border-t border-border bg-transparent px-3 text-sm outline-hidden placeholder:text-muted-foreground"
					/>
				</Command>
			</div>
		</>
	);
}
