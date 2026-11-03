/** Settings › omp settings: omp's own settings by its tabs, searched and edited one row at a time (`OmpSettingsTab`). */
import { Lock, X } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import type { AgentSettingChange, AgentSettingOption, AgentSettingRow, AgentSettings } from "../../../src/shared/agent-settings";
import { searchWords } from "../../../src/shared/every-word";
import type { OmpFile } from "../../../src/shared/models";
import { errorText } from "../../../src/json";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatValue, isChanged, ownerOf, type ShownGroup, type ShownTab, shownTabs, valueOf } from "../../omp-settings";
import { hashForSettings } from "../../routing";
import { SearchField } from "../search-field";
import { ToggleSwitch } from "../toggle-switch";
import { type Editing, ErrorText, FIELD, FileLink, LayerNotes, LINK, OrderedList, RAIL_BUTTON, Section, saveAgentSetting, useSaving } from "./editor";

/** What a row needs from the section: its save, and the Files link to a file that sets a value. */
interface RowContext {
	save: (row: AgentSettingRow, change: AgentSettingChange) => Promise<unknown>;
	/** The workspace settings file Files lists, which a locked row links to. */
	projectFile: OmpFile | undefined;
	onOpenFile: (path: string) => void;
}

/** What every control gets from its row: the ids that name and describe it, its value, and its save. */
interface ControlProps {
	row: AgentSettingRow;
	/** The id of the row's visible label, which names the control. */
	labelId: string;
	/** The id a native field takes, so the row's `<label>` focuses it. */
	controlId: string;
	value: unknown;
	disabled: boolean;
	onChange: (change: AgentSettingChange) => void;
}

function OptionSelect({ labelId, hintId, value, options, disabled, onPick }: { labelId: string; hintId: string | undefined; value: unknown; options: AgentSettingOption[]; disabled: boolean; onPick: (value: string | number) => void }) {
	// A value omp would not offer, written by hand, still shows as itself.
	const listed = options.some(option => option.value === value) || (typeof value !== "string" && typeof value !== "number") ? options : [...options, { value, label: String(value) }];
	return (
		<Select value={value} disabled={disabled} onValueChange={next => (typeof next === "string" || typeof next === "number") && onPick(next)}>
			<SelectTrigger aria-labelledby={labelId} aria-describedby={hintId} className="max-w-64">
				<SelectValue>{(shown: unknown) => listed.find(option => option.value === shown)?.label ?? String(shown)}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{listed.map(option => (
					<SelectItem key={String(option.value)} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** A text field that saves on Enter or when it loses focus, and reverts on Escape. Clearing it removes your value. */
function TextControl({ row, controlId, value, disabled, onChange }: ControlProps) {
	const initial = row.credential || value === undefined ? "" : String(value);
	const [draft, setDraft] = useState(initial);
	const commit = (): void => {
		if (draft === initial) return;
		if (row.credential) setDraft("");
		onChange(draft === "" ? { reset: true } : { value: draft });
	};
	const placeholder = row.credential ? (value === undefined ? "Not set" : "Set. Type to replace it") : typeof row.default === "string" && row.default ? row.default : "Not set";
	return (
		<input
			id={controlId}
			type={row.credential ? "password" : "text"}
			autoComplete="off"
			spellCheck={false}
			disabled={disabled}
			value={draft}
			placeholder={placeholder}
			onChange={event => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={event => {
				if (event.key === "Enter") commit();
				else if (event.key === "Escape") setDraft(initial);
			}}
			className={cn(FIELD, "w-64 disabled:cursor-not-allowed disabled:opacity-50")}
		/>
	);
}

/** JSON text for a list or a map, saved on ⌘Enter or when it loses focus; Escape reverts it, and clearing it removes your value. */
function JsonControl({ controlId, value, disabled, onChange }: ControlProps) {
	const initial = value === undefined ? "" : JSON.stringify(value, null, 2);
	const [draft, setDraft] = useState(initial);
	const [invalid, setInvalid] = useState<string | null>(null);
	const commit = (): void => {
		if (draft === initial) return;
		if (draft.trim() === "") return onChange({ reset: true });
		try {
			onChange({ value: JSON.parse(draft) });
			setInvalid(null);
		} catch (err) {
			setInvalid(errorText(err));
		}
	};
	return (
		<div className="space-y-1">
			<textarea
				id={controlId}
				spellCheck={false}
				disabled={disabled}
				value={draft}
				rows={Math.min(12, Math.max(3, draft.split("\n").length))}
				onChange={event => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={event => {
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") commit();
					else if (event.key === "Escape") {
						setDraft(initial);
						setInvalid(null);
					}
				}}
				className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
			/>
			{invalid && <ErrorText>Not JSON: {invalid}</ErrorText>}
		</div>
	);
}

/** Some of omp's choices: in order, moved and removed in place, or each on or off. */
function ListControl({ row, labelId, options, ordered, value, disabled, onChange }: ControlProps & { options: AgentSettingOption[]; ordered: boolean }) {
	const items = Array.isArray(value) ? value.map(String) : [];
	const labelOf = (item: string): string => options.find(option => option.value === item)?.label ?? item;
	if (!ordered) {
		return (
			<ul aria-labelledby={labelId} className="grid gap-1.5 sm:grid-cols-2">
				{options.map(option => (
					<li key={String(option.value)}>
						<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] has-[[data-disabled]]:cursor-not-allowed">
							<ToggleSwitch
								checked={items.includes(String(option.value))}
								disabled={disabled}
								onCheckedChange={on => onChange({ value: on ? [...items, String(option.value)] : items.filter(item => item !== String(option.value)) })}
							/>
							{option.label}
						</label>
					</li>
				))}
			</ul>
		);
	}
	const rest = options.filter(option => !items.includes(String(option.value)));
	return (
		<fieldset aria-labelledby={labelId} disabled={disabled} className="disabled:opacity-50">
			<OrderedList
				items={items}
				label={labelOf}
				onChange={next => onChange({ value: next })}
				render={item => <span className="text-[12px]">{labelOf(item)}</span>}
				add={
					rest.length > 0 && (
						<div className="pl-5">
							<Select value={null} onValueChange={next => next !== null && onChange({ value: [...items, String(next)] })}>
								<SelectTrigger aria-label={`Add to ${row.label}`}>
									<SelectValue placeholder="Add…" />
								</SelectTrigger>
								<SelectContent>
									{rest.map(option => (
										<SelectItem key={String(option.value)} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)
				}
			/>
		</fieldset>
	);
}

/** A request limit per provider: each one edited or removed in place, and a new one added below. */
function ProviderLimitsControl({ labelId, value, disabled, onChange }: ControlProps) {
	const limits: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const [provider, setProvider] = useState("");
	const [limit, setLimit] = useState("");
	const without = (name: string): Record<string, unknown> => Object.fromEntries(Object.entries(limits).filter(([other]) => other !== name));
	const add = (): void => {
		const name = provider.trim();
		if (!name || !(Number(limit) > 0)) return;
		onChange({ value: { ...limits, [name]: Number(limit) } });
		setProvider("");
		setLimit("");
	};
	return (
		<fieldset aria-labelledby={labelId} disabled={disabled} className="space-y-1.5 disabled:opacity-50">
			{Object.entries(limits).map(([name, current]) => (
				<div key={name} className="flex items-center gap-2 text-sm">
					<span className="w-40 truncate font-mono text-xs">{name}</span>
					<input
						type="number"
						inputMode="numeric"
						min={1}
						aria-label={`Request limit for ${name}`}
						defaultValue={String(current)}
						onBlur={event => {
							const next = event.currentTarget.value.trim();
							if (next === String(current)) return;
							onChange({ value: next === "" ? without(name) : { ...limits, [name]: Number(next) } });
						}}
						onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
						className={cn(FIELD, "w-24 tabular-nums")}
					/>
					<Tooltip content={`Remove the limit for ${name}`}>
						<Button variant="ghost" size="icon-compact" aria-label={`Remove the limit for ${name}`} onClick={() => onChange({ value: without(name) })}>
							<X />
						</Button>
					</Tooltip>
				</div>
			))}
			<div className="flex flex-wrap items-end gap-2">
				<label className="space-y-1 text-xs text-muted-foreground">
					Provider
					<input value={provider} onChange={event => setProvider(event.target.value)} className={cn(FIELD, "block w-40 text-foreground")} />
				</label>
				<label className="space-y-1 text-xs text-muted-foreground">
					Request limit
					<input
						type="number"
						inputMode="numeric"
						min={1}
						value={limit}
						onChange={event => setLimit(event.target.value)}
						onKeyDown={event => event.key === "Enter" && add()}
						className={cn(FIELD, "block w-24 tabular-nums text-foreground")}
					/>
				</label>
				<Button variant="secondary" size="compact" disabled={!provider.trim() || !(Number(limit) > 0)} onClick={add}>
					Add
				</Button>
			</div>
		</fieldset>
	);
}

/** The control a row's kind takes, whether it sits beside the label or below it, and whether it is a native field a `<label>` focuses. */
function rowControl(props: ControlProps, hintId: string | undefined): { element: ReactNode; placement: "inline" | "block"; native: boolean } {
	const { row, labelId, value, disabled, onChange } = props;
	// Keyed by the value, so a field's draft starts over from each answer.
	const key = JSON.stringify(value) ?? "";
	const { control } = row;
	switch (control.kind) {
		case "toggle":
			return { element: <ToggleSwitch aria-labelledby={labelId} checked={value === true} disabled={disabled} onCheckedChange={checked => onChange({ value: checked })} />, placement: "inline", native: false };
		case "select":
			return {
				element: <OptionSelect labelId={labelId} hintId={hintId} value={value} options={control.options} disabled={disabled} onPick={next => onChange({ value: next })} />,
				placement: "inline",
				native: false,
			};
		case "text":
			return { element: <TextControl key={key} {...props} />, placement: "inline", native: true };
		case "json":
			return { element: <JsonControl key={key} {...props} />, placement: "block", native: true };
		case "list":
			return { element: <ListControl {...props} options={control.options} ordered={control.ordered} />, placement: "block", native: false };
		case "provider-limits":
			return { element: <ProviderLimitsControl key={key} {...props} />, placement: "block", native: false };
	}
}

/** One setting: what it does, whether it differs from omp's default, its control, and the layer notes that apply. */
function SettingRow({ row, context: { save, projectFile, onOpenFile } }: { row: AgentSettingRow; context: RowContext }) {
	// The value a save sends shows while it runs.
	const saving = useSaving<{ shown: unknown }>();
	const labelId = useId();
	const controlId = useId();
	const hintId = useId();
	const busy = saving.saving !== null;
	const locked = row.workspace !== undefined;
	const value = saving.saving ? saving.saving.shown : valueOf(row);
	const disabled = busy || locked;
	const change = (next: AgentSettingChange): void =>
		saving.run({ shown: "value" in next ? next.value : locked ? row.workspace : row.default }, () => save(row, next));
	const { control } = row;
	// A choice's own description, which omp shows beside it, shows under the row for the one picked.
	const picked = control.kind === "select" ? control.options.find(option => option.value === value) : undefined;
	const hint = picked?.description ? `${picked.label}: ${picked.description}` : undefined;
	const { element, placement, native } = rowControl({ row, labelId, controlId, value, disabled, onChange: change }, hint ? hintId : undefined);
	const changed = isChanged(row);
	// Only a native field takes a `<label>`; the switch, the select, and the lists are named by the label's id.
	const label = native ? (
		<label id={labelId} htmlFor={controlId}>
			{row.label}
		</label>
	) : (
		<span id={labelId}>{row.label}</span>
	);
	return (
		<li aria-busy={busy} className={cn("space-y-2 py-3 transition-opacity motion-reduce:transition-none", busy && "opacity-60")}>
			<div className="flex items-start justify-between gap-6">
				<div className="min-w-0 space-y-0.5">
					<p className="flex items-center gap-1.5 text-sm font-medium">
						{label}
						{changed && (
							<Tooltip content={row.credential ? "Set" : `Changed. omp's default is ${formatValue(row, row.default)}`}>
								<span className="inline-flex size-4 items-center justify-center">
									<span aria-hidden className="size-1.5 rounded-full bg-primary" />
									<span className="sr-only">{row.credential ? "Set" : `Changed from omp's default, ${formatValue(row, row.default)}`}</span>
								</span>
							</Tooltip>
						)}
					</p>
					{row.warning && <p className="text-xs text-warning-foreground">{row.warning}</p>}
					<p className="text-xs text-muted-foreground">{row.description}</p>
					{hint && (
						<p id={hintId} className="text-xs text-muted-foreground">
							{hint}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{row.user !== undefined && (
						<Tooltip content={`Remove your value from config.yml${locked ? "" : `, back to ${row.credential ? "none" : formatValue(row, row.default)}`}`}>
							<Button variant="ghost" size="compact" disabled={busy} onClick={() => change({ reset: true })}>
								Reset
							</Button>
						</Tooltip>
					)}
					{locked && <Lock aria-hidden className="size-3.5 text-muted-foreground" />}
					{placement === "inline" && element}
				</div>
			</div>
			{placement === "block" && element}
			<LayerNotes
				workspace={locked}
				env={row.env}
				yourValue={formatValue(row, row.user ?? (row.credential ? undefined : row.default))}
				projectFile={projectFile}
				onOpenFile={onOpenFile}
			/>
			{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
		</li>
	);
}

function Group({ group, context }: { group: ShownGroup; context: RowContext }) {
	return (
		<div className="space-y-1">
			{group.label && <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>}
			<ul className="divide-y divide-border">
				{group.rows.map(row => (
					<SettingRow key={row.id} row={row} context={context} />
				))}
			</ul>
			{group.owned.map(({ owner, count }) => (
				<p key={owner.section} className="py-2 text-xs text-muted-foreground">
					{count === 1 ? "1 setting here is" : `${count} settings here are`} edited in{" "}
					<a href={hashForSettings(owner.section)} className={LINK}>
						{owner.label}
					</a>
					.
				</p>
			))}
		</div>
	);
}

function TabBody({ shown, context }: { shown: ShownTab; context: RowContext }) {
	return (
		<Section title={shown.tab.label}>
			{shown.groups.map(group => (
				<Group key={group.label ?? ""} group={group} context={context} />
			))}
		</Section>
	);
}

/**
 * omp's settings in its own tabs and groups, a search across them, and each row saved to your `config.yml` as you change it.
 * `configFile` and `projectFile` are the user's and the workspace's settings files Files lists, which the section links to.
 */
export function OmpSettingsTab({
	settings,
	configFile,
	projectFile,
	editing,
	onOpenFile,
}: {
	settings: AgentSettings;
	configFile: OmpFile | undefined;
	projectFile: OmpFile | undefined;
	editing: Editing;
	onOpenFile: (path: string) => void;
}) {
	const [tabId, setTabId] = useState(settings.tabs[0]?.id ?? "");
	const [query, setQuery] = useState("");
	const searching = searchWords(query).length > 0;
	const tabs = shownTabs(settings.tabs, query);
	const current = tabs.find(shown => shown.tab.id === tabId) ?? tabs[0];
	const matching = tabs.filter(shown => shown.groups.length > 0);
	const unlisted = settings.unlisted.filter(id => !ownerOf(id)).length;
	const context: RowContext = {
		save: (row, change) => saveAgentSetting(editing, { id: row.id, ...change, expected: row.user ?? null }),
		projectFile,
		onOpenFile,
	};
	const rail = useRef<HTMLElement>(null);
	const body = useRef<HTMLDivElement>(null);
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav ref={rail} aria-label="omp settings tabs" className="space-y-4 self-start md:sticky md:top-6">
				<SearchField label="Search omp settings" placeholder="Search" query={query} onQuery={setQuery} className="min-w-0 flex-1" />
				<ul>
					{tabs.map(shown => (
						<li key={shown.tab.id}>
							<button
								type="button"
								aria-current={!searching && shown === current ? "true" : undefined}
								onClick={() => {
									setTabId(shown.tab.id);
									setQuery("");
									// The rail stays put while the rows scroll, so a tab opened below the fold starts at its top.
									const top = body.current;
									if (top && rail.current && top.getBoundingClientRect().top < rail.current.getBoundingClientRect().top) top.scrollIntoView({ block: "start" });
								}}
								className={cn(RAIL_BUTTON, !searching && shown === current && "bg-muted font-medium", searching && shown.groups.length === 0 && "text-muted-foreground opacity-60")}
							>
								<span className="truncate">{shown.tab.label}</span>
								{shown.changed > 0 && (
									<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
										{shown.changed}
										<span className="sr-only"> changed</span>
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
				{unlisted > 0 && configFile && (
					<p className="px-2 text-xs text-muted-foreground">
						{unlisted === 1 ? "1 more setting has" : `${unlisted} more settings have`} no control here.{" "}
						<FileLink file={configFile} onOpenFile={onOpenFile}>
							Edit them in config.yml
						</FileLink>
					</p>
				)}
			</nav>
			<div ref={body} className="min-w-0 scroll-mt-6 space-y-6">
				<p className="text-xs text-muted-foreground">Running sessions pick up most changes; some apply only to sessions started after the change.</p>
				{searching ? (
					matching.length === 0 ? (
						<p className="text-sm text-muted-foreground">No setting matches.</p>
					) : (
						matching.map(shown => <TabBody key={shown.tab.id} shown={shown} context={context} />)
					)
				) : (
					current && <TabBody shown={current} context={context} />
				)}
			</div>
		</div>
	);
}
