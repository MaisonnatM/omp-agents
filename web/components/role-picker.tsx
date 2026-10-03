import { Bot, Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import type { ModelRole } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { modelLabel, modelOrg, roleLabel } from "../labels";
import type { RoleList } from "../use-model-roles";
import { OrgIcon } from "./org-icon";

interface RolePickerProps {
	/** The last list the server sent, or `null` while none has arrived. */
	list: RoleList | null;
	/** The role the session's model and thinking level match, `null` when none does. */
	current: ModelRole | null;
	/** Read the roles again; the picker asks on every open. */
	onReload: () => void;
	onPick: (role: ModelRole) => void;
	disabled?: boolean;
}

/** The composer's model role switch, left of the model picker: picking `plan` switches to the model and thinking level `modelRoles.plan` names. */
export function RolePicker({ list, current, onReload, onPick, disabled }: RolePickerProps) {
	const [open, setOpen] = useState(false);
	const openChange = (next: boolean): void => {
		setOpen(next);
		if (next) onReload();
	};
	return (
		<Popover open={open} onOpenChange={openChange}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="compact"
					leadingIcon={Bot}
					trailingIcon={ChevronsUpDown}
					aria-label={`Choose model role: ${current ? roleLabel(current.role) : "none matches the model"}`}
					active={open}
					disabled={disabled}
				>
					{current ? roleLabel(current.role) : "Role"}
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0" onMouseDown={event => event.stopPropagation()}>
				<Command>
					<CommandList>
						{list === null ? (
							<p role="status" className="py-6 text-center text-sm text-muted-foreground">
								Loading roles…
							</p>
						) : list.error ? (
							<p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
								{list.error}
							</p>
						) : list.roles.length === 0 ? (
							<p className="px-3 py-6 text-center text-sm text-muted-foreground">No role in modelRoles names a model you are connected to.</p>
						) : (
							<CommandGroup heading="Model role">
								{list.roles.map(role => {
									const selector = `${role.model.provider}/${role.model.id}`;
									return (
										<CommandItem
											key={role.role}
											value={role.role}
											title={role.thinking ? `${selector}:${role.thinking}` : selector}
											onSelect={() => {
												setOpen(false);
												if (role.role !== current?.role) onPick(role);
											}}
										>
											<span className="shrink-0">{roleLabel(role.role)}</span>
											<span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
												<OrgIcon org={modelOrg(selector)} />
												<span className="truncate">{modelLabel(selector)}</span>
												{role.thinking && <span className="shrink-0">· {role.thinking}</span>}
											</span>
											<Check className={cn("size-4", role.role === current?.role ? "opacity-100" : "opacity-0")} />
										</CommandItem>
									);
								})}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
