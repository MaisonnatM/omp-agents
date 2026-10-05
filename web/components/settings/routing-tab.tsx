import { Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type CatalogModel, type ModelChain, type ModelRouting, type OmpSettings, type RetrySettings, type RoleRoute, type RoutingEdit, splitSelector } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { putJson, settingsUrl } from "../../api";
import { providerOrg } from "../../labels";
import { CommandPicker, fromList } from "../command-picker";
import { MODEL_LIST, Model, modelDescription, modelGroups } from "../model-picker";
import { OrgIcon } from "../org-icon";
import { type Catalog, EditBar, type Editing, OrderedList, SaveError, Section, useEditor } from "./editor";

/** Each save answers with the settings as they load afterwards. */
const saveRouting = (cwd: string | null, edit: RoutingEdit): Promise<OmpSettings> => putJson<OmpSettings>(settingsUrl("/routing", cwd), edit);

const onOff = (value: boolean | number | string): string => (value ? "On" : "Off");
const duration = (value: boolean | number | string): string =>
	Number(value) < 1000 ? `${value} ms` : Number(value) < 60_000 ? `${Number(value) / 1000} s` : `${Number(value) / 60_000} min`;

/** `retry.*` rows in the order they matter for fallback, with omp's key, how each value reads, and the unit it is edited in. */
const RETRY_ROWS: [keyof RetrySettings, string, (value: boolean | number | string) => string, string?][] = [
	["modelFallback", "Model fallback", onOff],
	["usageAwareFallback", "Usage-aware fallback", onOff],
	["usageReservePct", "Reserve margin", value => `${value}%`, "%"],
	["usageReservePolicy", "Reserve policy", String],
	["fallbackRevertPolicy", "Return to primary", String],
	["enabled", "Retry on API errors", onOff],
	["maxRetries", "Retry attempts", String],
	["baseDelayMs", "Base delay", duration, "ms"],
	["maxDelayMs", "Max delay", value => (Number(value) === 0 ? "No ceiling" : duration(value)), "ms"],
	["waitForUsageReset", "Wait for usage reset", onOff],
];

const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Fallbacks in the order omp tries them. */
function Chain({ fallbacks }: { fallbacks: string[] }) {
	if (fallbacks.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<ol className="flex flex-wrap gap-x-4 gap-y-1">
			{fallbacks.map((selector, index) => (
				<li key={`${index}:${selector}`} className="flex items-baseline gap-1.5">
					<span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
					<Model selector={selector} />
				</li>
			))}
		</ol>
	);
}

/** A model `omp models` lists, then its thinking level. The value is omp's selector, `provider/id` with an optional `:level`. */
function SelectorPicker({ value, catalog, label, onPick }: { value: string | null; catalog: Catalog; label: string; onPick: (selector: string) => void }) {
	const models = catalog.data?.bySelector ?? null;
	const { model, level } = value && models ? splitSelector(value, models) : { model: value, level: null };
	const levels = (model && models?.get(model)?.thinking) || [];
	const pickModel = (next: CatalogModel): void => onPick(level && next.thinking.includes(level) ? `${next.selector}:${level}` : next.selector);
	return (
		<div className="flex min-w-0 items-center gap-1">
			<CommandPicker
				trigger={<span className="max-w-56 truncate">{model ? <Model selector={model} /> : "Choose a model"}</span>}
				ariaLabel={`${label}: ${model ? modelDescription(model) : "none"}`}
				className="min-w-0"
				search={MODEL_LIST.search}
				width="lg"
				list={fromList(catalog, MODEL_LIST.loading, ({ byProvider }) =>
					modelGroups(
						byProvider,
						option => ({ selector: option.selector, id: option.selector.slice(option.provider.length + 1), keywords: [option.name] }),
						model,
						pickModel,
					),
				)}
				empty={MODEL_LIST.empty}
			/>
			{model && (levels.length > 0 || level) && (
				<select
					aria-label={`${label}: thinking level`}
					className={FIELD}
					value={level ?? ""}
					onChange={event => onPick(event.target.value ? `${model}:${event.target.value}` : model)}
				>
					<option value="">default</option>
					{[...new Set([...levels, ...(level ? [level] : [])])].map(option => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			)}
		</div>
	);
}

function ChainEditor({ chain, catalog, onChange }: { chain: string[]; catalog: Catalog; onChange: (chain: string[]) => void }) {
	const [adding, setAdding] = useState(false);
	return (
		<OrderedList
			items={chain}
			label={selector => `fallback ${selector}`}
			onChange={onChange}
			render={(selector, index) => (
				<SelectorPicker
					value={selector}
					catalog={catalog}
					label={`Fallback ${index + 1}`}
					onPick={next => onChange(chain.map((entry, other) => (other === index ? next : entry)))}
				/>
			)}
			add={
				adding ? (
					<div className="flex items-center gap-1 pl-5">
						<SelectorPicker
							value={null}
							catalog={catalog}
							label="New fallback"
							onPick={selector => {
								setAdding(false);
								onChange([...chain, selector]);
							}}
						/>
						<Button variant="ghost" size="icon-compact" aria-label="Stop adding a fallback" onClick={() => setAdding(false)}>
							<X />
						</Button>
					</div>
				) : (
					<Button variant="ghost" size="compact" leadingIcon={Plus} onClick={() => setAdding(true)}>
						Add fallback
					</Button>
				)
			}
		/>
	);
}

function RoleRow({ route, editing }: { route: RoleRoute; editing: Editing }) {
	const editor = useEditor(
		{ primary: route.primary, fallbacks: route.fallbacks },
		draft =>
			saveRouting(editing.cwd, {
				kind: "role",
				role: route.role,
				...(draft.primary !== null && draft.primary !== route.primary && { primary: draft.primary }),
				// An unchanged inherited chain stays inherited rather than becoming a copy.
				...(JSON.stringify(draft.fallbacks) !== JSON.stringify(route.fallbacks) && { fallbacks: draft.fallbacks }),
			}),
		editing.saved,
	);
	const { draft } = editor;
	const viewing = editor.state.phase === "viewing";
	const inherited = route.inheritsDefault && JSON.stringify(draft.fallbacks) === JSON.stringify(route.fallbacks);
	return (
		<tr className="border-t border-border align-baseline">
			<th scope="row" className="py-2 pr-6 text-left font-medium">
				{route.role}
			</th>
			<td className="whitespace-nowrap py-2 pr-6">
				{viewing ? (
					route.primary ? (
						<Model selector={route.primary} />
					) : (
						<span className="text-muted-foreground">Not set</span>
					)
				) : (
					<SelectorPicker value={draft.primary} catalog={editing.catalog} label={`${route.role} model`} onPick={primary => editor.change({ ...draft, primary })} />
				)}
			</td>
			<td className="space-y-1 py-2 pr-4">
				{viewing ? <Chain fallbacks={route.fallbacks} /> : <ChainEditor chain={draft.fallbacks} catalog={editing.catalog} onChange={fallbacks => editor.change({ ...draft, fallbacks })} />}
				{inherited && <p className="text-xs text-muted-foreground">The default role's chain{viewing ? "" : ". Changing it gives this role its own."}</p>}
				{!viewing && route.role !== "default" && draft.fallbacks.length === 0 && (
					<p className="text-xs text-muted-foreground">With no fallbacks of its own, the role walks the default role's chain.</p>
				)}
				<SaveError editor={editor} />
			</td>
			<td className="py-2 text-right align-top">
				<EditBar editor={editor} label={`${route.role} role`} />
			</td>
		</tr>
	);
}

function ModelChainRow({ chain, editing }: { chain: ModelChain; editing: Editing }) {
	const editor = useEditor(chain.fallbacks, fallbacks => saveRouting(editing.cwd, { kind: "model-chain", key: chain.key, fallbacks }), editing.saved);
	return (
		<tr className="border-t border-border align-baseline">
			<th scope="row" className="py-2 pr-6 text-left font-mono text-xs font-medium">
				{chain.key}
			</th>
			<td className="space-y-1 py-2 pr-4">
				{editor.state.phase === "viewing" ? (
					<Chain fallbacks={chain.fallbacks} />
				) : (
					<ChainEditor chain={editor.draft} catalog={editing.catalog} onChange={editor.change} />
				)}
				<SaveError editor={editor} />
			</td>
			<td className="py-2 text-right align-top">
				<EditBar editor={editor} label={`chain for ${chain.key}`} />
			</td>
		</tr>
	);
}

/** A number typed as text, so the field can be cleared while typing; only a finite number reaches `onChange`. */
function NumberField({ value, id, onChange }: { value: number; id: string; onChange: (value: number) => void }) {
	const [text, setText] = useState(String(value));
	return (
		<input
			type="number"
			inputMode="numeric"
			id={id}
			className={cn(FIELD, "w-28 tabular-nums")}
			value={text}
			onChange={event => {
				setText(event.target.value);
				const next = Number(event.target.value);
				if (event.target.value.trim() !== "" && Number.isFinite(next)) onChange(next);
			}}
			onBlur={() => setText(String(value))}
		/>
	);
}

export function RetrySection({ routing, editing }: { routing: ModelRouting; editing: Editing }) {
	const editor = useEditor(
		routing.retry,
		draft =>
			saveRouting(editing.cwd, {
				kind: "retry",
				values: Object.fromEntries(Object.entries(draft).filter(([key, value]) => routing.retry[key as keyof RetrySettings] !== value)),
			}),
		editing.saved,
	);
	const set = (key: keyof RetrySettings, value: boolean | number | string): void => editor.change({ ...editor.draft, [key]: value });
	return (
		<Section title="Retry and fallback" actions={<EditBar editor={editor} label="retry and fallback" />}>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 text-sm">
				{RETRY_ROWS.map(([key, label, format, unit]) => {
					const value = editor.draft[key];
					const choices = routing.retryChoices[key];
					const id = `retry-${key}`;
					let field: ReactNode;
					if (editor.state.phase === "viewing") field = format(routing.retry[key]);
					else if (typeof value === "boolean") {
						field = <input type="checkbox" id={id} className="size-4 align-middle accent-current" checked={value} onChange={event => set(key, event.target.checked)} />;
					} else if (typeof value === "number") {
						field = (
							<span className="inline-flex items-center gap-1.5">
								<NumberField value={value} id={id} onChange={next => set(key, next)} />
								{unit && <span className="text-xs text-muted-foreground">{unit}</span>}
							</span>
						);
					} else {
						field = (
							<select id={id} className={FIELD} value={value} onChange={event => set(key, event.target.value)}>
								{(choices ?? [value]).map(choice => (
									<option key={choice} value={choice}>
										{choice}
									</option>
								))}
							</select>
						);
					}
					return (
						<div key={key} className="contents">
							<dt className="text-muted-foreground" title={`retry.${key}`}>
								{editor.state.phase === "viewing" ? label : <label htmlFor={id}>{label}</label>}
							</dt>
							<dd className="tabular-nums">{field}</dd>
						</div>
					);
				})}
			</dl>
			<SaveError editor={editor} />
		</Section>
	);
}

function ProviderPicker({ providers, onPick }: { providers: string[]; onPick: (provider: string) => void }) {
	return (
		<CommandPicker
			trigger="Add provider"
			icon={Plus}
			chevron={false}
			disabled={providers.length === 0}
			search={{ label: "Search providers" }}
			width="md"
			list={{
				kind: "ready",
				groups: [
					{
						key: "providers",
						items: providers.map(provider => ({
							value: provider,
							label: (
								<>
									<OrgIcon org={providerOrg(provider)} />
									{provider}
								</>
							),
							onSelect: () => onPick(provider),
						})),
					},
				],
			}}
			empty="No provider matches."
		/>
	);
}

function ProviderOrderSection({ order, editing }: { order: string[]; editing: Editing }) {
	const editor = useEditor(order, providers => saveRouting(editing.cwd, { kind: "provider-order", providers }), editing.saved);
	const { catalog } = editing;
	const unlisted = catalog.data ? [...catalog.data.byProvider.keys()].filter(provider => !editor.draft.includes(provider)) : [];
	const row = (provider: string): ReactNode => (
		<span className="flex items-center gap-2">
			<OrgIcon org={providerOrg(provider)} />
			{provider}
		</span>
	);
	return (
		<Section title="Provider order" actions={<EditBar editor={editor} label="provider order" />}>
			{editor.state.phase !== "viewing" ? (
				<OrderedList
					items={editor.draft}
					label={provider => provider}
					onChange={editor.change}
					render={row}
					add={<ProviderPicker providers={unlisted} onPick={provider => editor.change([...editor.draft, provider])} />}
				/>
			) : order.length === 0 ? (
				<p className="text-sm text-muted-foreground">Not set. omp picks among providers that serve a model by its own order.</p>
			) : (
				<ol className="space-y-2 text-sm">
					{order.map((provider, index) => (
						<li key={provider} className="flex items-center gap-2">
							<span className="w-3 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
							{row(provider)}
						</li>
					))}
				</ol>
			)}
			<SaveError editor={editor} />
		</Section>
	);
}

/** Roles, per-model chains, and provider order: which model a session gets and where its fallbacks are served from. */
export function RolesTab({ routing, configPath, editing }: { routing: ModelRouting; configPath: string | undefined; editing: Editing }) {
	return (
		<>
			<Section title="Model roles" meta={configPath && `Saved to ${configPath}`}>
				{routing.roles.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No roles are set. omp uses its own defaults until <code>modelRoles</code> names a model.
					</p>
				) : (
					<table className="w-full text-sm">
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th scope="col" className="pb-2 pr-6 font-medium">
									Role
								</th>
								<th scope="col" className="pb-2 pr-6 font-medium">
									Model
								</th>
								<th scope="col" className="pb-2 font-medium">
									Fallbacks, in order
								</th>
								<th scope="col" className="pb-2">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{routing.roles.map(route => (
								<RoleRow key={route.role} route={route} editing={editing} />
							))}
						</tbody>
					</table>
				)}
			</Section>
			{routing.modelChains.length > 0 && (
				<Section title="Chains for a model" meta="These apply whenever the model is active, whatever its role.">
					<table className="w-full text-sm">
						<tbody>
							{routing.modelChains.map(chain => (
								<ModelChainRow key={chain.key} chain={chain} editing={editing} />
							))}
						</tbody>
					</table>
				</Section>
			)}
			<ProviderOrderSection order={routing.modelProviderOrder} editing={editing} />
		</>
	);
}
