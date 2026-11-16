import { MCP_SERVICES } from "../../../src/shared/accounts";
import type { MODULE_LIST } from "../../modules";
import { useModulesOff } from "../../modules-off";
import { hashForSettings } from "../../routing";
import { useSidebarTabs } from "../../sidebar-tabs";
import { ToggleSwitch } from "../toggle-switch";
import { LINK, Section } from "./editor";

/** Settings › Modules › `module`: what it is for, and a switch that turns it on or off on every machine. */
export function ModuleTab({ module: { id, tab, about } }: { module: (typeof MODULE_LIST)[number] }) {
	const [off, turn] = useModulesOff();
	const { signedOut } = useSidebarTabs();
	return (
		<Section title={tab.label} meta={about}>
			<div className="space-y-2">
				<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px]">
					<ToggleSwitch checked={!off.has(id)} onCheckedChange={on => turn(id, !on)} />
					Show {tab.label}
				</label>
				<p className="text-xs text-muted-foreground">
					Turned off, its page, its sidebar tab, its shortcuts, and its commands go away.
					{id === "sport" && " New sessions no longer get the sport tool; sessions already running keep it."}
				</p>
				{tab.integration !== undefined && signedOut.has(id) && (
					<p className="text-xs text-muted-foreground">
						Shows only while {MCP_SERVICES[tab.integration].label} is connected.{" "}
						<a href={hashForSettings("integrations")} className={LINK}>
							Connect it in Integrations
						</a>
					</p>
				)}
			</div>
		</Section>
	);
}
