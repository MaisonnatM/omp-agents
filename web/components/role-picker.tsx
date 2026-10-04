import { Bot } from "lucide-react";
import type { ModelRole } from "../../src/shared";
import { modelLabel, modelOrg, roleLabel } from "../labels";
import type { RoleList } from "../use-model-roles";
import { CommandPicker, fromList } from "./command-picker";
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
	return (
		<CommandPicker
			trigger={current ? roleLabel(current.role) : "Role"}
			icon={Bot}
			ariaLabel={`Choose model role: ${current ? roleLabel(current.role) : "none matches the model"}`}
			disabled={disabled}
			width="md"
			side="top"
			onOpenChange={next => {
				if (next) onReload();
			}}
			list={fromList(list, "Loading roles…", ({ roles }) => [
				{
					key: "roles",
					heading: "Model role",
					items: roles.map(role => {
						const selector = `${role.model.provider}/${role.model.id}`;
						return {
							value: role.role,
							title: role.thinking ? `${selector}:${role.thinking}` : selector,
							label: (
								<>
									<span className="shrink-0">{roleLabel(role.role)}</span>
									<span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
										<OrgIcon org={modelOrg(selector)} />
										<span className="truncate">{modelLabel(selector)}</span>
										{role.thinking && <span className="shrink-0">· {role.thinking}</span>}
									</span>
								</>
							),
							selected: role.role === current?.role,
							onSelect: () => {
								if (role.role !== current?.role) onPick(role);
							},
						};
					}),
				},
			])}
			empty={<span className="text-muted-foreground">No role in modelRoles names a model you are connected to.</span>}
		/>
	);
}
