import { IconPencil, IconPlusLarge, IconTrashCan } from "central-icons";
import { useId, useState } from "react";
import type { ServedBuild } from "../../../src/served-build";
import { MCP_SERVICES } from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { appendToComposer, newDraftKey } from "../../composer-drafts";
import { deleteModulePrompt, editModulePrompt, newModulePrompt } from "../../module-prompts";
import { MODULE_LIST } from "../../modules";
import { useModulesOff } from "../../modules-off";
import { useRead } from "../../reads";
import { hashForSettings } from "../../routing";
import { useSidebarTabs } from "../../sidebar-tabs";
import { useDashboardActions } from "../dashboard-context";
import { FIELD, Field, TEXT_AREA } from "../form-field";
import { FormDialog, FormDialogHeader, isSubmitChord } from "../form-dialog";
import { IntegrationList, IntegrationRow, MarkTile, MetaDot } from "../integrations/integration-row";
import { Confirm } from "../integrations/mcp-connection-controls";
import { MoreActionsMenu } from "../more-actions-menu";
import { ToggleSwitch } from "../toggle-switch";
import { LINK, Section } from "./editor";

type Module = (typeof MODULE_LIST)[number];

/** The dialog open over the list: a new module's, or an edit of `module`. */
type Asking = { kind: "new" } | { kind: "edit"; module: Module };

/** A dialog with one or two text fields that puts the prompt they make in the New session draft. */
function PromptDialog({ title, fields, submit, onClose, onSubmit }: {
	title: string;
	fields: readonly { label: string; area: boolean }[];
	submit: string;
	onClose: () => void;
	onSubmit: (values: string[]) => void;
}) {
	const id = useId();
	const [values, setValues] = useState(() => fields.map(() => ""));
	const ready = values.every(value => value.trim() !== "");
	return (
		<FormDialog busy={false} onClose={onClose} className="top-[15vh] w-[min(32rem,calc(100vw-2rem))]">
			<FormDialogHeader title={title} busy={false} />
			<form
				className="space-y-5 p-4"
				onSubmit={event => {
					event.preventDefault();
					if (ready) onSubmit(values);
				}}
				onKeyDown={event => {
					if (isSubmitChord(event)) {
						event.preventDefault();
						event.currentTarget.requestSubmit();
					}
				}}
			>
				{fields.map(({ label, area }, index) => {
					const props = {
						id: `${id}-${index}`,
						required: true,
						autoFocus: index === 0,
						value: values[index],
						onChange: (event: { target: { value: string } }) => setValues(prev => prev.with(index, event.target.value)),
					};
					return (
						<Field key={label} label={label} htmlFor={props.id}>
							{area ? <textarea {...props} rows={4} className={TEXT_AREA} /> : <input {...props} className={`${FIELD} w-full`} />}
						</Field>
					);
				})}
				<p className="text-xs text-muted-foreground">Opens a new session in the omp agents checkout with this request in its message box, for you to review and send.</p>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" size="compact" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" size="compact" disabled={!ready}>
						{submit}
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}

/** Settings › Modules: every module the page is built with, a switch that turns each on or off on every machine, and New, Edit, and Delete, which open an agent session that writes the code. */
export function ModulesTab() {
	const [off, turn] = useModulesOff();
	const { signedOut } = useSidebarTabs();
	const { openNewSession } = useDashboardActions();
	const build = useRead<ServedBuild>("/api/dashboard/build");
	// A packaged app serves a prebuilt page, so there is no checkout to change; until the answer comes, the actions wait.
	const checkout = build.data?.source?.checkout ?? null;
	const [asking, setAsking] = useState<Asking | null>(null);
	const [deleting, setDeleting] = useState<Module["id"] | null>(null);
	const draft = (prompt: string): void => {
		if (checkout === null) return;
		setAsking(null);
		appendToComposer(newDraftKey(null), prompt);
		openNewSession(checkout);
	};
	return (
		<Section
			meta="The features beside sessions, each one you can turn off, change, or remove"
			actions={
				checkout !== null && (
					<Button variant="secondary" size="compact" leadingIcon={IconPlusLarge} onClick={() => setAsking({ kind: "new" })}>
						New module
					</Button>
				)
			}
		>
			<IntegrationList label="Modules">
				{MODULE_LIST.map(module => {
					const { id, tab, about } = module;
					const signedOutNote = tab.integration !== undefined && signedOut.has(id);
					const sportNote = id === "sport";
					return (
						<IntegrationRow
							key={id}
							name={tab.label}
							mark={<MarkTile icon={tab.icon} name={tab.label} />}
							status={null}
							summary={about}
							meta={
								(signedOutNote || sportNote) && (
									<>
										{sportNote && <span>While Sport is off, new sessions don't get the sport tool; running sessions keep it.</span>}
										{sportNote && signedOutNote && <MetaDot />}
										{tab.integration !== undefined && signedOutNote && (
											<span>
												Shows only while {MCP_SERVICES[tab.integration].label} is connected.{" "}
												<a href={hashForSettings("integrations")} className={LINK}>
													Connect it in Integrations
												</a>
											</span>
										)}
									</>
								)
							}
							actions={
								<>
									<ToggleSwitch aria-label={`Turn on ${tab.label}`} checked={!off.has(id)} onCheckedChange={on => turn(id, !on)} />
									{checkout !== null && (
										<MoreActionsMenu name={tab.label}>
											<MenuItem onClick={() => setAsking({ kind: "edit", module })}>
												<IconPencil />
												Edit
											</MenuItem>
											<MenuSeparator />
											<MenuItem variant="destructive" onClick={() => setDeleting(id)}>
												<IconTrashCan />
												Delete
											</MenuItem>
										</MoreActionsMenu>
									)}
								</>
							}
						>
							{deleting === id && (
								<Confirm
									icon={IconTrashCan}
									question={`Delete ${tab.label}?`}
									detail={`${tab.label} turns off now. A new session opens with a request to remove its code, for you to review and send. Its saved data stays on disk.`}
									confirm="Turn off and open session"
									run={async () => {
										turn(id, true);
										draft(deleteModulePrompt({ id, label: tab.label }));
									}}
									onDone={() => setDeleting(null)}
								/>
							)}
						</IntegrationRow>
					);
				})}
			</IntegrationList>
			<p className="px-1 text-xs text-muted-foreground">A module that is off loses its page, sidebar tab, shortcuts, and commands.</p>
			{build.error !== null && <p role="alert" className="px-1 text-xs text-red-600 dark:text-red-400">Cannot check for a source checkout: {build.error}</p>}
			{build.data !== null && checkout === null && <p className="px-1 text-xs text-muted-foreground">Adding or changing modules needs omp agents running from its source checkout.</p>}
			{asking?.kind === "new" && (
				<PromptDialog
					title="New module"
					fields={[
						{ label: "Name", area: false },
						{ label: "What should it do?", area: true },
					]}
					submit="Open session"
					onClose={() => setAsking(null)}
					onSubmit={([name, does]) => draft(newModulePrompt(name!, does!))}
				/>
			)}
			{asking?.kind === "edit" && (
				<PromptDialog
					title={`Edit ${asking.module.tab.label}`}
					fields={[{ label: "What should change?", area: true }]}
					submit="Open session"
					onClose={() => setAsking(null)}
					onSubmit={([change]) => draft(editModulePrompt({ id: asking.module.id, label: asking.module.tab.label }, change!))}
				/>
			)}
		</Section>
	);
}
