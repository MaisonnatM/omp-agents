/** `BotMenu`, what right-clicking a Bot's sidebar row or gallery card offers: pin it and move it between sections; and `SectionNameDialog`, which names a new section or renames one. */
import { Folder, FolderInput, FolderMinus, FolderPlus, Pin, PinOff } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { type Bot, MAX_SECTION_LENGTH, parseSectionName } from "../../../src/shared/bots";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuSeparator, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { FIELD } from "../form-field";
import { FormDialog, FormDialogHeader } from "../form-dialog";

/** What {@link SectionNameDialog} names: a new section for `bot`, or section `from` again. */
export type SectionNaming = { kind: "new"; bot: Bot } | { kind: "rename"; from: string };

interface BotMenuProps {
	bot: Bot;
	/** Every section, as `botSections` lists them. */
	sections: readonly string[];
	onName: (naming: SectionNaming) => void;
	/** The element right-clicking opens the menu on, such as the row's `SidebarMenuItem`. */
	render: ReactElement;
	children: ReactNode;
}

export function BotMenu({ bot, sections, onName, render, children }: BotMenuProps) {
	return (
		<ContextMenu>
			<ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<BotMenuItems bot={bot} sections={sections} onName={onName} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** The menu's items, which mount only while it is open, so a closed menu reads none of the dashboard's state. */
function BotMenuItems({ bot, sections, onName }: Omit<BotMenuProps, "render" | "children">) {
	const { changeBot } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const others = sections.filter(name => name !== bot.section);
	return (
		<>
			<MenuItem disabled={!connected} onClick={() => changeBot({ op: "pin", id: bot.id, pinned: !bot.pinned })}>
				{bot.pinned ? <PinOff /> : <Pin />}
				{bot.pinned ? "Unpin" : "Pin"}
			</MenuItem>
			<MenuSubmenu>
				<MenuSubmenuTrigger disabled={!connected} value={bot.section ?? undefined}>
					<FolderInput />
					Move to section
				</MenuSubmenuTrigger>
				<MenuSubmenuContent>
					{others.map(name => (
						<MenuItem key={name} onClick={() => changeBot({ op: "move", id: bot.id, section: name })}>
							<Folder />
							<span className="truncate">{name}</span>
						</MenuItem>
					))}
					{others.length > 0 && <MenuSeparator />}
					<MenuItem onClick={() => onName({ kind: "new", bot })}>
						<FolderPlus />
						New section…
					</MenuItem>
				</MenuSubmenuContent>
			</MenuSubmenu>
			{bot.section !== null && (
				<MenuItem disabled={!connected} onClick={() => changeBot({ op: "move", id: bot.id, section: null })}>
					<FolderMinus />
					Remove from section
				</MenuItem>
			)}
		</>
	);
}

/** Names a new section, which the Bot it is for moves into, or renames a section for every Bot in it. */
export function SectionNameDialog({ naming, onClose }: { naming: SectionNaming; onClose: () => void }) {
	const { changeBot } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [name, setName] = useState(naming.kind === "rename" ? naming.from : "");
	const section = parseSectionName(name);
	const save = (): void => {
		if (section === null || !connected) return;
		changeBot(naming.kind === "new" ? { op: "move", id: naming.bot.id, section } : { op: "rename-section", from: naming.from, to: section });
		onClose();
	};
	return (
		<FormDialog busy={false} onClose={onClose} className="top-[20%] w-[min(24rem,calc(100vw-2rem))]">
			<FormDialogHeader title={naming.kind === "new" ? `New section for ${naming.bot.name}` : "Rename section"} busy={false} />
			<form
				className="flex flex-col gap-3 px-4 pt-3 pb-4"
				onSubmit={event => {
					event.preventDefault();
					save();
				}}
			>
				<input
					aria-label="Section name"
					autoFocus
					maxLength={MAX_SECTION_LENGTH}
					placeholder="Section name"
					value={name}
					onChange={event => setName(event.target.value)}
					className={cn(FIELD, "h-8 w-full")}
				/>
				<div className="flex justify-end">
					<Button type="submit" size="compact" disabled={section === null || !connected}>
						Save
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}
