import { IconPencil, IconPlusLarge, IconTrashCan } from "central-icons";
import { useId, useState } from "react";
import type { ServedBuild } from "../../../src/served-build";
import { MCP_SERVICES } from "../../../src/shared/accounts";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { appendToComposer, newDraftKey } from "../../composer-drafts";
import { deleteModulePrompt, editModulePrompt, newModulePrompt } from "../../module-prompts";
import { MODULE_LIST, type WebModuleId } from "../../modules";
import { useModulesOff } from "../../modules-off";
import { useRead } from "../../reads";
import { hashForSettings } from "../../routing";
import { useSignedOutTabs } from "../../sidebar-tabs";
import { useDashboardActions } from "../dashboard-context";
import { FIELD, Field, TEXT_AREA } from "../form-field";
import { FormDialog, FormDialogHeader, isSubmitChord } from "../form-dialog";
import { IntegrationList, IntegrationRow, MarkTile, MetaDot } from "../integrations/integration-row";
import { Confirm } from "../integrations/mcp-connection-controls";
import { MoreActionsMenu } from "../more-actions-menu";
import { ToggleSwitch } from "../toggle-switch";
import { LINK, Section } from "./editor";

type Module = (typeof MODULE_LIST)[number];

/** What is open over the list: a new module's dialog, an edit's, or the question under a row before its removal. */
type Asking = { kind: "new" } | { kind: "edit"; module: Module } | { kind: "delete"; id: WebModuleId };

/** A dialog that asks `question`, and a Name first when `named`, then puts the prompt they make in the New session draft. */
function PromptDialog({ title, named, question, onClose, onSubmit }: {
	title: string;
	named: boolean;
	question: string;
	onClose: () => void;
	onSubmit: (text: string, name: string) => void;
}) {
	const id = useId();
	const [name, setName] = useState("");
	const [text, setText] = useState("");
	const ready = text.trim() !== "" && (!named || name.trim() !== "");
	return (
		<FormDialog busy={false} onClose={onClose} className="top-[15vh] w-[min(32rem,calc(100vw-2rem))]">
			<FormDialogHeader title={title} busy={false} />
			<form
				className="space-y-5 p-4"
				onSubmit={event => {
					event.preventDefault();
					if (ready) onSubmit(text, name);
				}}
				onKeyDown={event => {
					if (isSubmitChord(event)) {
						event.preventDefault();
						event.currentTarget.requestSubmit();
					}
				}}
			>
				{named && (
					<Field label="Name" htmlFor={`${id}-name`}>
						<input id={`${id}-name`} required autoFocus value={name} onChange={event => setName(event.target.value)} className={`${FIELD} w-full`} />
					</Field>
				)}
				<Field label={question} htmlFor={`${id}-text`}>
					<textarea id={`${id}-text`} required autoFocus={!named} rows={4} value={text} onChange={event => setText(event.target.value)} className={TEXT_AREA} />
				</Field>
				<p className="text-xs text-muted-foreground">Opens a new session in the omp agents checkout with this request in its message box, for you to review and send.</p>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" size="compact" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" size="compact" disabled={!ready}>
						Open session
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}

/** Settings › Modules: every module the page is built with, a switch that turns each on or off on every machine, and New, Edit, and Delete, which open an agent session that writes the code. */
export function ModulesTab() {
	const [off, setOn] = useModulesOff();
	const signedOut = useSignedOutTabs();
	const { openNewSession } = useDashboardActions();
	const build = useRead<ServedBuild>("/api/dashboard/build");
	// A packaged app serves a prebuilt page, so there is no checkout to change; until the answer comes, the actions wait.
	const checkout = build.data?.source?.checkout ?? null;
	const [asking, setAsking] = useState<Asking | null>(null);
	const draft = (cwd: string, prompt: string): void => {
		setAsking(null);
		appendToComposer(newDraftKey(null), prompt);
		openNewSession(cwd);
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
					const offNote = "offNote" in module ? module.offNote : undefined;
					const service = tab.integration !== undefined && signedOut.has(id) ? MCP_SERVICES[tab.integration] : null;
					return (
						<IntegrationRow
							key={id}
							name={tab.label}
							mark={<MarkTile icon={tab.icon} name={tab.label} />}
							status={null}
							summary={about}
							meta={
								(offNote !== undefined || service !== null) && (
									<>
										{offNote !== undefined && <span>{offNote}</span>}
										{offNote !== undefined && service !== null && <MetaDot />}
										{service !== null && (
											<span>
												Shows only while {service.label} is connected.{" "}
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
									<ToggleSwitch aria-label={`Turn on ${tab.label}`} checked={!off.has(id)} onCheckedChange={on => setOn(id, on)} />
									{checkout !== null && (
										<MoreActionsMenu name={tab.label}>
											<MenuItem onClick={() => setAsking({ kind: "edit", module })}>
												<IconPencil />
												Edit
											</MenuItem>
											<MenuSeparator />
											<MenuItem variant="destructive" onClick={() => setAsking({ kind: "delete", id })}>
												<IconTrashCan />
												Delete
											</MenuItem>
										</MoreActionsMenu>
									)}
								</>
							}
						>
							{checkout !== null && asking?.kind === "delete" && asking.id === id && (
								<Confirm
									icon={IconTrashCan}
									question={`Delete ${tab.label}?`}
									detail={`${tab.label} turns off now. A new session opens with a request to remove its code, for you to review and send. Its saved data stays on disk.`}
									confirm="Turn off and open session"
									run={async () => {
										setOn(id, false);
										draft(checkout, deleteModulePrompt({ id, label: tab.label }));
									}}
									onDone={() => setAsking(null)}
								/>
							)}
						</IntegrationRow>
					);
				})}
			</IntegrationList>
			<p className="px-1 text-xs text-muted-foreground">A module that is off loses its page, sidebar tab, shortcuts, and commands.</p>
			{build.error !== null && <p role="alert" className="px-1 text-xs text-red-600 dark:text-red-400">Cannot check for a source checkout: {build.error}</p>}
			{build.data !== null && checkout === null && <p className="px-1 text-xs text-muted-foreground">Adding or changing modules needs omp agents running from its source checkout.</p>}
			{checkout !== null && asking?.kind === "new" && (
				<PromptDialog
					title="New module"
					named
					question="What should it do?"
					onClose={() => setAsking(null)}
					onSubmit={(does, name) => draft(checkout, newModulePrompt(name, does))}
				/>
			)}
			{checkout !== null && asking?.kind === "edit" && (
				<PromptDialog
					title={`Edit ${asking.module.tab.label}`}
					named={false}
					question="What should change?"
					onClose={() => setAsking(null)}
					onSubmit={change => draft(checkout, editModulePrompt({ id: asking.module.id, label: asking.module.tab.label }, change))}
				/>
			)}
		</Section>
	);
}
